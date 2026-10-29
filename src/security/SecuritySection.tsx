// Security Settings.
//
// Two co-existing security stacks:
//   1. Biometric passkey (FaceID / TouchID / Android Enclave)
//      → derives the Notebook AES-256 master key via HKDF-SHA-256.
//   2. TOTP fallback (RFC 6238) with QR code + Google Authenticator
//      compatibility. Encrypted at rest by the biometric-derived key
//      (or Phase-1 device key if biometric isn't enrolled).

import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
  BackHandler,
} from "react-native";

import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import {
  enroll as bioEnroll,
  getBiometricAvailability,
  isEnrolled as bioIsEnrolled,
  unenroll as bioUnenroll,
  type BiometricAvailability,
} from "@/src/security/biometric";
import { invalidateBiometricUnlock } from "@/src/security/BiometricGate";
import {
  readLockScope,
  writeLockScope,
} from "@/src/security/lock-scope-store";
import {
  disableBiometricAuth,
  enableBiometricAuth,
} from "@/src/security/session-keystore";
import { loadBook } from "@/src/wallet/wallet-book";

export function SecuritySection({
  showHeading = true,
}: {
  showHeading?: boolean;
} = {}) {
  const toast = useToast();
  const [bioAvail, setBioAvail] = useState<BiometricAvailability>("no_hardware");
  const [bioOn, setBioOn] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBioAvail(await getBiometricAvailability());
    setBioOn(await bioIsEnrolled());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const turnBiometricOff = useCallback(async () => {
    setBioBusy(true);
    try {
      await bioUnenroll();
      setBioOn(false);
      try {
        const book = await loadBook();
        for (const w of book.entries) {
          await disableBiometricAuth(w.id);
        }
        await writeLockScope("off");
      } catch (e) {
        console.warn("[SecuritySection] disableBiometricAuth failed", e);
      }
      toast.show(
        "Fingerprint unlock is off. Type your seed the next time the app locks.",
        "info",
      );
    } finally {
      setBioBusy(false);
    }
  }, [toast]);

  const onToggleBio = useCallback(
    async (next: boolean) => {
      if (!next) {
        const warning =
          "You will have to type your seed the next time the app locks. Backup files are not changed. A backup still opens with that seed on this phone or another phone.";
        if (Platform.OS === "web") {
          const ok =
            typeof window !== "undefined" &&
            window.confirm(`Turn off fingerprint unlock?\n\n${warning}`);
          if (ok) void turnBiometricOff();
          return;
        }
        Alert.alert("Turn off fingerprint unlock?", warning, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Turn off",
            style: "destructive",
            onPress: () => {
              void turnBiometricOff();
            },
          },
        ]);
        return;
      }
      setBioBusy(true);
      try {
        if (next) {
          const result = await bioEnroll();
          if (result.ok) {
            setBioOn(true);
            const currentScope = await readLockScope();
            if (currentScope === "off") {
              await writeLockScope("entire_app");
            }
            try {
              const book = await loadBook();
              for (const w of book.entries) {
                await enableBiometricAuth(w.id);
              }
            } catch (e) {
              console.warn("[SecuritySection] enableBiometricAuth failed", e);
            }
            toast.show(
              "Biometric unlock enabled. Your wallet stays protected on this device.",
              "success",
            );
          } else {
            toast.show(
              result.reason ?? "Biometric enrollment failed.",
              "error",
            );
          }
        }
      } finally {
        setBioBusy(false);
      }
    },
    [toast, turnBiometricOff],
  );

  const bioBlocked = bioAvail === "no_hardware";
  const bioNeedsSystemEnroll = bioAvail === "not_enrolled";
  const bioWebPreview = bioAvail === "unsupported_web";

  const [bioExpanded, setBioExpanded] = useState<boolean>(!bioOn);

  return (
    <View>
      {showHeading ? <Text style={styles.section}>SECURITY</Text> : null}

      {bioOn && !bioExpanded ? (
        // Compact "chip" mode — one row, status pill on the right,
        // whole card is a tap target that expands.
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setBioExpanded(true)}
          style={styles.card}
          testID="settings-security-biometric-compact"
        >
          <View style={styles.row}>
            <View style={styles.iconWrap}>
              <Feather name="shield" size={16} color={colors.teal} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Biometric</Text>
              <View style={styles.statusChipRow}>
                <View style={styles.statusChip}>
                  <View style={styles.statusChipDot} />
                  <Text style={styles.statusChipText}>Active</Text>
                </View>
                <Text style={styles.compactHint}>Tap to manage</Text>
              </View>
            </View>
            <Feather
              name="chevron-down"
              size={16}
              color={colors.textSecondary}
            />
          </View>
        </TouchableOpacity>
      ) : (
        <>
          <View style={styles.card} testID="settings-security-biometric-card">
            <View style={styles.row}>
              <View style={styles.iconWrap}>
                <Feather name="shield" size={16} color={colors.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Biometric passkey</Text>
                <Text style={styles.sub}>
                  Uses your device Secure Enclave (FaceID, TouchID, Android
                  Biometrics) to unlock your encrypted wallet. Never leaves
                  the device.
                </Text>
              </View>
              <Switch
                testID="settings-security-biometric-switch"
                value={bioOn}
                disabled={bioBusy || bioBlocked}
                onValueChange={onToggleBio}
                trackColor={{ true: colors.teal, false: colors.trackOff }}
                thumbColor={Platform.OS === "android" ? colors.thumbOn : undefined}
                ios_backgroundColor={colors.trackOff}
              />
            </View>
            {bioWebPreview ? (
              <Text style={styles.hint} testID="settings-security-biometric-web-hint">
                Web preview only — biometrics require a native build.
              </Text>
            ) : bioBlocked ? (
              <Text style={styles.hint}>
                This device has no biometric hardware.
              </Text>
            ) : bioNeedsSystemEnroll ? (
              <Text style={styles.hint}>
                Add a fingerprint or Face ID in your device settings first.
              </Text>
            ) : null}
            {bioOn ? (
              <TouchableOpacity
                onPress={() => setBioExpanded(false)}
                style={styles.collapseRow}
                testID="settings-security-biometric-collapse"
              >
                <Feather
                  name="chevron-up"
                  size={12}
                  color={colors.textSecondary}
                />
                <Text style={styles.collapseText}>Collapse</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Biometric is a single toggle: on = "require biometrics to
              open the
              app AND unlock the wallet seed at the Keystore level".
              No granular scope. `lock-scope-store.ts` still supports
              the old shapes for backward-compat with existing installs,
              but the UI no longer surfaces custom flags — enabling
              biometric here writes `scope="entire_app"` so BiometricGate
              guards everywhere. */}

          {bioOn ? (
            <TouchableOpacity
              onPress={() => {
                invalidateBiometricUnlock();
                if (Platform.OS === "android") {
                  ToastAndroid.show("Locking…", ToastAndroid.SHORT);
                  setTimeout(() => {
                    BackHandler.exitApp();
                  }, 800);
                } else {
                  toast.show("Locking… close the app to re-authenticate.", "success");
                }
              }}
              activeOpacity={0.75}
              style={[styles.card, styles.lockNowBtn]}
              testID="settings-security-lock-now"
            >
              <Feather name="lock" size={16} color={colors.teal} />
              <Text style={styles.lockNowText}>Lock now</Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}

    </View>
  );
}



const styles = StyleSheet.create({
  section: {
    color: colors.textTertiary, fontSize: 11, ...typography.label,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 32, height: 32,
    alignItems: "center", justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
  },
  title: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 15 },
  hint: {
    color: colors.textTertiary, fontSize: 11,
    marginTop: spacing.sm, paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  eyebrow: {
    color: colors.textTertiary, fontSize: 10, ...typography.label,
    marginTop: spacing.md, marginBottom: 4,
  },
  primaryBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.teal,
    minHeight: 36,
    alignItems: "center", justifyContent: "center",
  },
  primaryBtnText: { color: colors.textInverse, fontSize: 12, fontWeight: "700" },
  ghostBtn: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    minHeight: 36,
    alignItems: "center", justifyContent: "center",
  },
  ghostBtnText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  setupBlock: { marginTop: spacing.md, alignItems: "stretch" },
  setupTitle: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: spacing.sm },
  qrHost: {
    alignItems: "center", padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  secretRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 10,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.sm,
  },
  secretText: {
    flex: 1, color: colors.text, fontSize: 12, ...typography.mono,
  },
  copyBtn: {
    width: 32, height: 32,
    alignItems: "center", justifyContent: "center",
    borderRadius: radii.sm,
  },
  confirmRow: { flexDirection: "row", gap: 8, marginTop: spacing.sm },
  enabledPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: "flex-start",
    backgroundColor: "rgba(76, 175, 80, 0.12)",
  },
  enabledText: { color: colors.success, fontSize: 11, fontWeight: "700" },
  lockNowBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderColor: colors.teal,
    borderWidth: 1,
    backgroundColor: colors.tealMuted,
  },
  lockNowText: { color: colors.teal, fontSize: 14, fontWeight: "800" },
  statusChipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
  },
  statusChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },
  statusChipText: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  compactHint: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: "600",
  },
  collapseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 6,
    paddingVertical: 4,
  },
  collapseText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  scopeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginTop: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  scopeRowActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  scopeLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  scopeSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  radioOn: { borderColor: colors.teal },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.teal,
  },
  customBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    gap: 4,
  },
  customRow: {},
});
