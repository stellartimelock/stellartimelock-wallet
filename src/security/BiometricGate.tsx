// Session-wide biometric gate. One session is either LOCKED or UNLOCKED;
// `session-keystore` is the source of truth.
//
// Unlock priority:
//   1. Biometric scanner launches automatically when the gate first appears.
//      Cold start unwraps the biometric-cached 32-byte signing key (never
//      the S… seed). Lock clears the in-memory seed; the next fingerprint
//      unwraps the derived key again.
//   2. If biometric is cancelled or fails, a manual "Unlock" button stays.
//   3. "Use seed instead" is a secondary fallback — first-ever entry, a
//      new phone, or a missing derived-key blob. After a successful seed
//      entry the derived key is cached behind biometrics.
//   4. No fingerprint on the phone, a failed fingerprint, or no answer
//      within UNLOCK_FALLBACK_TIMEOUT_MS: a message and a "Use seed
//      instead" button, plus "Try fingerprint again" when the phone has
//      a fingerprint. With `offerSeedWhenStranded`, a wallet that has no
//      seed in memory and no biometric key is gated too, so it is never
//      a blank screen. The typed seed must open the active G address.

import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  authenticate as bioAuthenticate,
  getBiometricAvailability,
  isEnrolled as bioIsEnrolled,
  type BiometricAvailability,
} from "@/src/security/biometric";
import {
  canRetryFingerprint,
  checkSeedForWallet,
  fallbackMessage,
  fallbackReason,
  isStrandedWallet,
  seedShapeError,
  UNLOCK_FALLBACK_TIMEOUT_MS,
} from "@/src/security/unlock-fallback";
import {
  shouldGate,
  type CustomLockFlags,
} from "@/src/security/lock-scope-store";
import { colors, radii, spacing, typography } from "@/src/theme";
import { trackEvent } from "@/src/analytics/firebase";
import {
  isUnlocked as keystoreIsUnlocked,
  lockNow as lockSessionKeystore,
  subscribeSessionLock,
  warmSessionAfterBiometric,
  warmSessionFromVerifiedSeed,
  hasAnySessionSeed,
  hasDerivedSigningKey,
  hasSessionSeed,
} from "@/src/security/session-keystore";
import { loadActiveKeypair, loadBook } from "@/src/wallet/wallet-book";
import { keypairFromSecretSeed } from "@/src/wallet/stellar";
import { keypairFromMnemonic } from "@/src/wallet/seed-phrase";
import { useSession } from "@/src/state/session";
/** Public helper — used by anywhere that wants the boolean without
 *  importing session-keystore directly. */
export function isSessionUnlocked(): boolean {
  return keystoreIsUnlocked();
}

/**
 * Programmatic lock trigger — used by Settings → Lock Now and by
 * the "invalidate unlock" path when a user unenrolls biometric.
 */
export function invalidateBiometricUnlock(): void {
  // Session-keystore is the authoritative "unlocked" state; wiping
  // it also drives every gate back to the LOCKED screen via the
  // subscribeSessionLock listener bus.
  lockSessionKeystore();
  trackEvent({ name: "vault_locked" });
}

interface BiometricGateProps {
  /** Single surface OR array of surfaces. Kept for backward-compat
   * with existing call sites; the new global-lock model applies
   * uniformly to every surface, so `surface` is effectively just a
   * telemetry / testID hint. */
  surface: keyof CustomLockFlags | (keyof CustomLockFlags)[];
  children: React.ReactNode;
  /**
   * Balance Quick Settings tile. The locked screen is unchanged, but
   * the balance stays behind a fresh biometric even when the session
   * was already unlocked. Other screens leave this unset.
   */
  requireUnlock?: boolean;
  /** Changes on each tile tap so a second tap asks again. */
  promptKey?: string;
  /**
   * Gate the active wallet when this process has no seed and there is
   * no biometric-wrapped key, so the seed can be entered. Set by the
   * wallet tab's unlocking state.
   */
  offerSeedWhenStranded?: boolean;
}

export function BiometricGate({
  surface,
  children,
  requireUnlock = false,
  promptKey,
  offerSeedWhenStranded = false,
}: BiometricGateProps) {
  const surfaces = useMemo(
    () => (Array.isArray(surface) ? surface : [surface]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(surface) ? surface.join(",") : surface],
  );
  const surfaceKey = surfaces.join(",");
  const { ready, wallet, browseMode, setWallet } = useSession();
  const [needed, setNeeded] = useState<boolean | null>(null); // null = still checking
  const [attempting, setAttempting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passedKey = useRef<string | null>(null);
  const prompting = useRef(false);
  const token = promptKey ?? "once";

  // Tracks whether we have already auto-launched for the current lock event
  // (resets when the gate unlocks so the next re-lock auto-launches again).
  const autoPromptedToken = useRef<string | null>(null);

  // Seed fallback modal state
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [seedInput, setSeedInput] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  // Show fallback only after the first auto-launch attempt completes.
  const [showFallback, setShowFallback] = useState(false);
  // Why the seed is being offered (see unlock-fallback.ts).
  const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
  const [stranded, setStranded] = useState(false);
  const [attemptFailed, setAttemptFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const check = useCallback(async () => {
    // Web / preview: no hardware biometric → skip the gate. On web
    // the session-keystore aliases to plain storage, so seeds are
    // always "available" without any prompt anyway.
    if (Platform.OS === "web") {
      setNeeded(false);
      return;
    }
    // Wait for SessionProvider boot to avoid racing the keystore prompt.
    if (!ready) {
      setNeeded(null);
      return;
    }
    // Balance tile: always ask, including when this session is already open.
    if (requireUnlock && passedKey.current !== token) {
      setNeeded(true);
      return;
    }
    // Browse-without-seed: no key material to unlock — never gate.
    if (browseMode && !wallet) {
      setNeeded(false);
      return;
    }
    if (keystoreIsUnlocked()) {
      setNeeded(false);
      return;
    }
    // Seed still in RAM (lock has not cleared it yet) — always gate.
    if (hasAnySessionSeed()) {
      setNeeded(true);
      return;
    }
    // Cold start with a biometric-cached derived key — always gate,
    // even if Settings never flipped the enroll toggle.
    const book = await loadBook();
    const hasBlob = book.activeId ? await hasDerivedSigningKey(book.activeId) : false;
    if (book.activeId && hasBlob) {
      setStranded(false);
      setNeeded(true);
      return;
    }
    // Wallet tab: a saved wallet with no seed in memory and no biometric
    // key. Without this it rendered an empty screen with no way forward.
    if (
      offerSeedWhenStranded &&
      isStrandedWallet({
        ready,
        hasWallet: !!wallet,
        browseMode,
        activeId: book.activeId,
        activeEntryExists: book.entries.some((e) => e.id === book.activeId),
        hasSessionSeed: book.activeId ? hasSessionSeed(book.activeId) : false,
        hasDerivedKey: hasBlob,
      })
    ) {
      setStranded(true);
      setNeeded(true);
      return;
    }
    setStranded(false);
    // Otherwise ask lock-scope-store whether we should gate at all.
    // (Users who have never enrolled biometric never see the gate.)
    const enrolled = await bioIsEnrolled();
    let gate = false;
    for (const s of surfaceKey.split(",") as (keyof CustomLockFlags)[]) {
      if (await shouldGate(s, enrolled)) {
        gate = true;
        break;
      }
    }
    setNeeded(gate);
  }, [ready, browseMode, wallet, requireUnlock, token, surfaceKey, offerSeedWhenStranded]);

  useEffect(() => {
    check();
    // Subscribe to session-keystore transitions so we can flip
    // in/out of the gate as OTHER surfaces unlock / lock the session.
    const unsub = subscribeSessionLock(() => {
      check();
    });
    // Re-check on app-foreground: an idle-lock during background
    // may have wiped the cache while we were away.
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      unsub();
      sub.remove();
    };
  }, [check]);

  // Reset auto-prompt tracking when the gate unlocks so the next
  // lock event will trigger a fresh auto-launch.
  useEffect(() => {
    if (needed === false) {
      autoPromptedToken.current = null;
      setShowFallback(false);
      setAttemptFailed(false);
      setTimedOut(false);
    }
  }, [needed]);

  // Learn whether the phone can do a fingerprint before the first prompt.
  useEffect(() => {
    if (needed !== true) return;
    let live = true;
    void getBiometricAvailability().then((a) => {
      if (live) setAvailability(a);
    });
    return () => {
      live = false;
    };
  }, [needed]);

  // A prompt that never answers must not leave the user stuck.
  useEffect(() => {
    if (needed !== true || showFallback) return;
    const t = setTimeout(() => {
      setTimedOut(true);
      setShowFallback(true);
    }, UNLOCK_FALLBACK_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [needed, showFallback]);

  const doUnlock = useCallback(async () => {
    setAttempting(true);
    setError(null);
    try {
      const book = await loadBook();
      const activeId = book.activeId;
      const idle = activeId ? hasSessionSeed(activeId) : hasAnySessionSeed();
      const hasBlob = activeId ? await hasDerivedSigningKey(activeId) : false;

      // Seed still in RAM: LocalAuth is the fingerprint, then the cache hit.
      // Lock clears that cache. A derived-key blob unwraps through the
      // biometric root, which is its own fingerprint. Do not stack both.
      if (idle || !hasBlob) {
        const ok = await bioAuthenticate("Unlock Stellar TimeLock");
        if (!ok) {
          setAttemptFailed(true);
          setError("Biometric not recognised. Try again or use your seed.");
          return;
        }
      }
      if (requireUnlock) passedKey.current = token;
      let warmed = false;
      if (activeId) {
        warmed = await warmSessionAfterBiometric(activeId);
      }
      const kp = await loadActiveKeypair();
      if (kp) {
        setWallet(kp);
        setNeeded(false);
      } else {
        if (requireUnlock) passedKey.current = null;
        setNeeded(true);
        setAttemptFailed(true);
        setError(
          warmed
            ? "Biometric not recognised. Try again or use your seed."
            : "Enter your seed once to enable fingerprint unlock.",
        );
      }
    } catch (e) {
      if (requireUnlock) passedKey.current = null;
      setNeeded(true);
      setAttemptFailed(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAttempting(false);
    }
  }, [requireUnlock, token, setWallet]);

  // Auto-launch biometric scanner once per lock event.
  // For requireUnlock (balance tile): re-prompts whenever token changes.
  // For normal gates: prompts once, then shows the manual unlock screen.
  useEffect(() => {
    if (needed !== true || prompting.current) return;
    if (requireUnlock && passedKey.current === token) return;
    // Wait until we know whether the phone has a fingerprint.
    if (availability === null) return;
    // Already auto-prompted for this lock event / token.
    if (autoPromptedToken.current === token) return;
    autoPromptedToken.current = token;
    // No fingerprint on this phone: a prompt cannot succeed. Offer the seed.
    if (!canRetryFingerprint(availability) && availability !== "unsupported_web") {
      setShowFallback(true);
      return;
    }
    setShowFallback(false);
    prompting.current = true;
    void doUnlock().finally(() => {
      prompting.current = false;
      // Reveal seed fallback after the first auto-launch resolves so
      // it is a fallback, never the first thing the user sees.
      setShowFallback(true);
    });
  }, [needed, requireUnlock, token, doUnlock, availability]);

  // Still deciding whether to gate — render nothing (avoid flicker).
  if (needed === null) return null;
  if (!needed) return <>{children}</>;

  const label = surfaces.length === 1 ? surfaces[0] : surfaces.join(" + ");
  const reason = showFallback
    ? fallbackReason({ availability, stranded, attemptFailed, timedOut })
    : "none";
  const notice = fallbackMessage(reason);
  const canRetry = canRetryFingerprint(availability);
  const sid = surfaces.join("-");

  const handleSeedUnlock = async () => {
    if (seedBusy) return;
    const shape = seedShapeError(seedInput);
    if (shape) {
      setSeedError(shape);
      return;
    }
    setSeedBusy(true);
    setSeedError(null);
    try {
      const book = await loadBook();
      if (!book.activeId) {
        setSeedError("No active wallet found.");
        return;
      }
      const entry = book.entries.find((e) => e.id === book.activeId);
      if (!entry) {
        setSeedError("Wallet metadata missing.");
        return;
      }
      // The seed must open the active wallet's G address. It stays in
      // memory; nothing new is written.
      const checked = checkSeedForWallet(
        seedInput,
        entry.publicKey,
        (s) => keypairFromSecretSeed(s).publicKey,
        (phrase) => keypairFromMnemonic(phrase),
      );
      if (!checked.ok) {
        setSeedError(checked.error);
        return;
      }
      warmSessionFromVerifiedSeed(book.activeId, checked.seed);
      const fullKp = await loadActiveKeypair();
      if (fullKp) setWallet(fullKp);
      setShowSeedModal(false);
      setSeedInput("");
      setSeedError(null);
      setNeeded(false);
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : "Unlock failed. Please try again.");
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <View style={styles.root} testID={`biometric-gate-${surfaces.join("-")}`}>
      <View style={styles.iconWrap}>
        <Feather name="lock" size={40} color={colors.teal} />
      </View>
      <Text style={styles.title}>Locked</Text>
      {notice ? (
        <View style={styles.notice} testID={`biometric-gate-fallback-message-${sid}`}>
          <Feather name="info" size={18} color={colors.teal} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : (
        <Text style={styles.sub}>
          This {label} section is protected by your biometrics.
        </Text>
      )}
      {error && !notice ? <Text style={styles.error}>{error}</Text> : null}

      {notice ? (
        <>
          <TouchableOpacity
            onPress={() => {
              setSeedInput("");
              setSeedError(null);
              setShowSeedModal(true);
            }}
            style={styles.btn}
            testID={`biometric-gate-seed-fallback-${sid}`}
            accessibilityRole="button"
          >
            <Feather name="key" size={18} color={colors.textInverse} />
            <Text style={styles.btnText}>Use seed instead</Text>
          </TouchableOpacity>
          {canRetry ? (
            <TouchableOpacity
              onPress={() => {
                void doUnlock();
              }}
              disabled={attempting}
              style={[styles.retryBtn, attempting && { opacity: 0.5 }]}
              testID={`biometric-gate-retry-${sid}`}
              accessibilityRole="button"
            >
              <Feather
                name={attempting ? "loader" : "unlock"}
                size={16}
                color={colors.teal}
              />
              <Text style={styles.retryBtnText}>
                {attempting ? "Verifying…" : "Try fingerprint again"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {/* Primary: biometric unlock */}
      {!notice ? (
      <TouchableOpacity
        onPress={doUnlock}
        disabled={attempting}
        style={[styles.btn, attempting && { opacity: 0.5 }]}
        testID={`biometric-gate-unlock-${surfaces.join("-")}`}
      >
        <Feather
          name={attempting ? "loader" : "unlock"}
          size={18}
          color={colors.textInverse}
        />
        <Text style={styles.btnText}>
          {attempting ? "Verifying…" : "Unlock with biometrics"}
        </Text>
      </TouchableOpacity>
      ) : null}

      {/* Seed fallback — shown after the first auto-launch attempt */}
      {showFallback && !notice ? (
        <TouchableOpacity
          onPress={() => {
            setSeedInput("");
            setSeedError(null);
            setShowSeedModal(true);
          }}
          style={styles.seedBtn}
          testID={`biometric-gate-seed-fallback-${surfaces.join("-")}`}
        >
          <Feather name="key" size={14} color={colors.textSecondary} />
          <Text style={styles.seedBtnText}>Use seed instead</Text>
        </TouchableOpacity>
      ) : null}

      {/* Seed entry modal */}
      <Modal
        visible={showSeedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSeedModal(false)}
        testID={`biometric-gate-seed-modal-${surfaces.join("-")}`}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={seedBusy ? undefined : () => setShowSeedModal(false)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Feather name="key" size={22} color={colors.teal} />
            </View>
            <Text style={styles.modalTitle}>Enter your seed</Text>
            <Text style={styles.modalSub}>
              Type or paste a 12- or 24-word recovery phrase, or a 56-character secret seed.
              It stays in memory and must match this wallet.
            </Text>
            <TextInput
              value={seedInput}
              onChangeText={(t) => {
                setSeedInput(t);
                setSeedError(null);
              }}
              placeholder="S… (56 characters)"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              secureTextEntry={false}
              style={styles.seedInput}
              testID={`biometric-gate-seed-input-${surfaces.join("-")}`}
            />
            {seedError ? (
              <Text style={styles.seedError}>{seedError}</Text>
            ) : null}
            <TouchableOpacity
              onPress={() => { void handleSeedUnlock(); }}
              disabled={seedBusy || seedInput.trim().length === 0}
              style={[
                styles.modalBtn,
                (seedBusy || seedInput.trim().length === 0) && { opacity: 0.5 },
              ]}
              testID={`biometric-gate-seed-submit-${surfaces.join("-")}`}
            >
              <Text style={styles.modalBtnText}>
                {seedBusy ? "Verifying…" : "Unlock"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowSeedModal(false)}
              disabled={seedBusy}
              style={styles.modalCancel}
              testID={`biometric-gate-seed-cancel-${surfaces.join("-")}`}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    ...typography.display,
    marginTop: 4,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: "center",
    marginTop: 8,
    marginBottom: spacing.lg,
    maxWidth: 320,
    lineHeight: 22,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: spacing.sm,
    textAlign: "center",
    maxWidth: 300,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.teal,
  },
  btnText: { color: colors.textInverse, fontSize: 16, fontWeight: "700" },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    padding: spacing.md,
    maxWidth: 340,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  noticeText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  retryBtnText: { color: colors.teal, fontSize: 15, fontWeight: "700" },

  seedBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.lg,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  seedBtnText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
    textDecorationLine: "underline",
  },

  // Seed fallback modal
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
  },
  modalIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  modalSub: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  seedInput: {
    width: "100%",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    minHeight: 56,
    textAlignVertical: "top",
  },
  seedError: {
    color: colors.danger,
    fontSize: 13,
    textAlign: "center",
    alignSelf: "stretch",
  },
  modalBtn: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: radii.md,
    backgroundColor: colors.teal,
  },
  modalBtnText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: "700",
  },
  modalCancel: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
});
