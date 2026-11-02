import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { Checkbox } from "@/src/components/Checkbox";
import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { isGuidedTourActive } from "@/src/onboarding/guided-tour";
import { colors, radii, spacing, typography } from "@/src/theme";
import { setWalletMnemonic } from "@/src/security/session-keystore";
import type { KeyManagerEntry } from "@/src/security/key-manager-store";
import {
  canUseKeyManagerWalletSync,
  importKeyManagerEntryAsWallet,
  listImportableKeyManagerEntries,
  promptSaveWalletToKeyManager,
} from "@/src/wallet/key-manager-wallet-sync";
import {
  getCurrentTier,
  hydrateTier,
} from "@/src/tiers/tier-config";
import { importManualBackup } from "@/src/utils/manual-backup/manual-backup";
import {
  InvalidMnemonicError,
  isValidMnemonic,
  keypairFromMnemonic,
  looksLikeMnemonic,
  normalizeMnemonic,
} from "@/src/wallet/seed-phrase";
import {
  InvalidSecretSeedError,
  keypairFromSecretSeed,
  shortenAddress,
} from "@/src/wallet/stellar";

export default function Import() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { setWallet, addImportedWallet, refreshWallets, setCurrency } = useSession();

  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);
  // After seed import succeeds, offer optional .stvault restore before
  // navigating into the wallet. Secret is held only for decrypting the
  // backup envelope (same seed that just unlocked the wallet).
  const [restorePromptVisible, setRestorePromptVisible] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreSecretRef = useRef<string | null>(null);
  // Second prompt: import additional wallets already stored in Key Manager.
  const [kmImportVisible, setKmImportVisible] = useState(false);
  const [kmImportBusy, setKmImportBusy] = useState(false);
  const [kmCandidates, setKmCandidates] = useState<KeyManagerEntry[]>([]);
  const [kmPlusAccess, setKmPlusAccess] = useState(false);
  const [kmSelected, setKmSelected] = useState<Set<string>>(new Set());
  const [kmAllChecked, setKmAllChecked] = useState(true);
  const importedPublicKeyRef = useRef<string | null>(null);
  const importedLabelRef = useRef<string>("");
  const importedMnemonicRef = useRef<string | null>(null);

  const [nickname, setNickname] = useState("");
  const [recognized, setRecognized] = useState(false);
  // Mirrors `nickname` for the async lookup below so it can check
  // "did the user already type something?" without needing to be
  // re-run on every keystroke of its own auto-fill.
  const nicknameRef = useRef(nickname);
  useEffect(() => {
    nicknameRef.current = nickname;
  }, [nickname]);

  const trimmed = seed.trim();
  const isPhrase = looksLikeMnemonic(trimmed);
  const cleanSeed = trimmed.replace(/\s+/g, "").toUpperCase();
  const looksValidSeed = cleanSeed.length === 56 && cleanSeed.startsWith("S");
  const looksValidPhrase = isPhrase && isValidMnemonic(trimmed);
  const looksValid = looksValidSeed || looksValidPhrase;

  // Wallet Nickname Auto-Lookup — as soon as the pasted/typed seed
  // resolves to a valid keypair, check whether this exact public key
  // already has a nickname saved from a previous session (e.g. the
  // user saved it as an Address Book contact before ever importing it
  // here as a signing wallet). If found, pre-fill the name field
  // instead of leaving the user to name it from scratch — but never
  // clobber a name they're already typing themselves.
  useEffect(() => {
    if (!looksValid) {
      setRecognized(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const kp = isPhrase
          ? keypairFromMnemonic(trimmed)
          : keypairFromSecretSeed(cleanSeed);
        const { suggestLabelForPublicKey } = await import(
          "@/src/wallet/wallet-book"
        );
        const found = await suggestLabelForPublicKey(kp.publicKey);
        if (cancelled) return;
        if (found) {
          setRecognized(true);
          if (!nicknameRef.current.trim()) setNickname(found);
        } else {
          setRecognized(false);
        }
      } catch {
        if (!cancelled) setRecognized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cleanSeed, looksValid, isPhrase, trimmed]);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      const cleaned = (text ?? "").trim();
      if (!cleaned) {
        toast.show("Clipboard is empty.", "error");
        return;
      }
      if (looksLikeMnemonic(cleaned)) {
        setSeed(normalizeMnemonic(cleaned));
        toast.show("Recovery phrase pasted.", "success");
        return;
      }
      // Otherwise assume it's meant to be a Stellar S-key. Strip any
      // stray whitespace inside the pasted content (some sources
      // wrap the key across lines) and uppercase-normalise so the
      // downstream validity check reads correctly.
      const normalised = cleaned.replace(/\s+/g, "").toUpperCase();
      setSeed(normalised);
      toast.show("Pasted from clipboard.", "success");
    } catch {
      toast.show("Couldn't read the clipboard.", "error");
    }
  };

  const handleImport = async () => {
    if (busy) return;
    if (!looksValid) {
      toast.show(
        isPhrase
          ? "Enter a valid 12- or 24-word recovery phrase."
          : "Secret seed must be 56 chars and start with S.",
        "error",
      );
      return;
    }

    let createdMetaId: string | null = null;
    let wasAlreadyImported = false;
    const requestedNickname = nickname.trim();
    let mnemonicToStore: string | null = null;
    let secretForImport = cleanSeed;
    try {
      setBusy(true);
      if (isPhrase) {
        const mnemonic = normalizeMnemonic(trimmed);
        const derived = keypairFromMnemonic(mnemonic);
        secretForImport = derived.secretSeed;
        mnemonicToStore = mnemonic;
      }
      // Same wallet-book path as raw S… import — phrase only supplies the secret.
      const { meta, wasAlreadyImported: dup, autoMatchedLabel } = await addImportedWallet(
        requestedNickname,
        secretForImport,
      );
      if (mnemonicToStore) {
        await setWalletMnemonic(meta.id, mnemonicToStore);
      }
      createdMetaId = dup ? null : meta.id; // only roll back fresh entries
      wasAlreadyImported = dup;

      // Load the keypair we just persisted. This is now diagnostic
      // only — if it fails, the entry gets cleaned up below.
      const { loadKeypair } = await import("@/src/wallet/wallet-book");
      const kp = await loadKeypair(meta.id);
      if (!kp) {
        throw new Error(
          "Wallet was created but the secret couldn't be read back from secure storage. Try again — if this keeps happening, restart the app.",
        );
      }
      setPreviewAddress(kp.publicKey);
      // Backend registration is best-effort. Never let it fail the
      // whole import.
      await api.registerWallet(kp.publicKey).catch(() => {
        /* backend optional */
      });
      setWallet(kp);
      if (wasAlreadyImported) {
        toast.show(
          `This wallet is already in your list${meta.label ? ` as "${meta.label}"` : ""}. Switched to it.`,
          "success",
        );
      } else if (autoMatchedLabel) {
        // Recognized from a saved Address Book contact.
        toast.show(
          `We recognized this address — welcomed back as "${meta.label}".`,
          "success",
        );
      } else if (requestedNickname && meta.label !== requestedNickname) {
        // Label collision auto-renamed by the book helper.
        toast.show(
          `Wallet restored as "${meta.label}" (name was taken).`,
          "success",
        );
      } else {
        toast.show(
          meta.label ? `Wallet restored as "${meta.label}"` : "Wallet restored",
          "success",
        );
      }
      // Import succeeded — clear the rollback handle so the finally
      // block doesn't undo it.
      createdMetaId = null;
      importedPublicKeyRef.current = kp.publicKey;
      importedLabelRef.current = meta.label;
      importedMnemonicRef.current = mnemonicToStore;
      // Offer optional .stvault restore before entering the wallet.
      restoreSecretRef.current = kp.secretSeed;
      setRestorePromptVisible(true);
    } catch (e) {
      // Rollback: if we created a fresh entry and something failed
      // afterwards, remove it so retry starts from a clean slate and
      // no orphan wallet lingers in Settings → WALLETS.
      if (createdMetaId) {
        try {
          const { removeWallet } = await import("@/src/wallet/wallet-book");
          await removeWallet(createdMetaId);
        } catch {
          /* best effort */
        }
      }
      const msg =
        e instanceof InvalidMnemonicError
          ? "That doesn't look like a valid recovery phrase. Check the words and try again."
          : e instanceof InvalidSecretSeedError
          ? "That doesn't look like a valid Stellar secret seed. Double-check the 56-character key (starts with S) from your other wallet."
          : "Couldn't import that wallet. Please try again.";
      console.warn("[Import] wallet import failed:", e);
      toast.show(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const leaveImport = () => {
    restoreSecretRef.current = null;
    importedPublicKeyRef.current = null;
    importedMnemonicRef.current = null;
    setRestorePromptVisible(false);
    setKmImportVisible(false);
    setKmCandidates([]);
    void (async () => {
      if (await isGuidedTourActive()) {
        router.replace("/create-vault");
      } else {
        router.replace("/(tabs)/wallet");
      }
    })();
  };

  /** After restore (or skip), offer Key Manager wallets / save-to-KM, then leave. */
  const afterRestoreStep = async () => {
    setRestorePromptVisible(false);
    try {
      await hydrateTier().catch(() => undefined);
      const plus = canUseKeyManagerWalletSync(getCurrentTier());
      setKmPlusAccess(plus);
      const exclude = importedPublicKeyRef.current
        ? [importedPublicKeyRef.current]
        : [];
      const candidates = await listImportableKeyManagerEntries(exclude);
      if (candidates.length > 0) {
        setKmCandidates(candidates);
        // Pre-check all wallets so Import Selected has a full selection
        // by default. Import All ignores checkboxes and never confirms.
        setKmSelected(new Set(candidates.map((c) => c.id)));
        setKmAllChecked(true);
        setKmImportVisible(true);
        return;
      }
    } catch {
      /* non-fatal — fall through to KM save offer */
    }
    await offerSaveMainToKeyManagerThenLeave();
  };

  const offerSaveMainToKeyManagerThenLeave = async () => {
    const secret = restoreSecretRef.current;
    const publicKey = importedPublicKeyRef.current;
    if (!secret || !publicKey) {
      leaveImport();
      return;
    }
    const result = await promptSaveWalletToKeyManager({
      label: importedLabelRef.current || "Wallet",
      secretSeed: secret,
      publicAddress: publicKey,
      seedPhrase: importedMnemonicRef.current ?? undefined,
    });
    if (result === "saved") {
      toast.show("Saved to Key Manager", "success");
    } else if (result === "error") {
      toast.show("Couldn't save to Key Manager.", "error");
    }
    leaveImport();
  };

  const onSkipRestore = () => {
    if (restoreBusy) return;
    void afterRestoreStep();
  };

  const onImportBackup = async () => {
    if (restoreBusy) return;
    const secret = restoreSecretRef.current;
    if (!secret) {
      void afterRestoreStep();
      return;
    }
    setRestoreBusy(true);
    try {
      const r = await importManualBackup(secret);
      if (r.ok && r.applied) {
        if (r.applied.currency) await setCurrency(r.applied.currency).catch(() => undefined);
        await refreshWallets().catch(() => undefined);
        const walletBit =
          (r.applied.wallets ?? 0) > 0
            ? `, ${r.applied.wallets} wallet name${r.applied.wallets === 1 ? "" : "s"}`
            : "";
        toast.show(
          `Imported ${r.applied.addresses} contacts, ${r.applied.totp ?? 0} authenticator entries, ${r.applied.keys ?? 0} saved keys${walletBit}.`,
          "success",
        );
        await afterRestoreStep();
      } else if (r.error === "Import cancelled.") {
        // Keep the prompt open so they can retry or skip.
      } else {
        toast.show(r.error ?? "Import failed.", r.tone === "info" ? "info" : "error");
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const onSkipKmImport = () => {
    if (kmImportBusy) return;
    void offerSaveMainToKeyManagerThenLeave();
  };

  const toggleKmWallet = (id: string) => {
    setKmSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setKmAllChecked(next.size === kmCandidates.length);
      return next;
    });
  };

  const toggleKmAll = () => {
    if (kmAllChecked) {
      setKmSelected(new Set());
      setKmAllChecked(false);
    } else {
      setKmSelected(new Set(kmCandidates.map((c) => c.id)));
      setKmAllChecked(true);
    }
  };

  const importOneKmEntry = async (entry: KeyManagerEntry): Promise<boolean> => {
    const { wasAlreadyImported } = await importKeyManagerEntryAsWallet(entry, {
      makeActive: false,
    });
    return !wasAlreadyImported;
  };

  const finishKmImport = async (
    imported: number,
    skipped: number,
    attempted: number,
  ) => {
    await refreshWallets().catch(() => undefined);
    if (imported > 0) {
      toast.show(
        `Imported ${imported} wallet${imported === 1 ? "" : "s"}`,
        "success",
      );
    } else if (skipped > 0) {
      toast.show("No additional wallets imported.", "info");
    } else if (attempted > 0) {
      toast.show("Wallets are already in your switcher.", "info");
    }
    await offerSaveMainToKeyManagerThenLeave();
  };

  /** Import Selected: confirm each wallet, then import the ones accepted. */
  const onImportSelectedKm = () => {
    const selected = kmCandidates.filter((c) => kmSelected.has(c.id));
    void (async () => {
      if (kmImportBusy) return;
      if (!kmPlusAccess) {
        toast.show(
          "Importing Key Manager wallets requires Plus or higher. Upgrade in Settings → Test Tier Selection.",
          "info",
        );
        return;
      }
      if (selected.length === 0) {
        toast.show("Select at least one wallet to import.", "info");
        return;
      }
      setKmImportBusy(true);
      try {
        let imported = 0;
        let skipped = 0;
        for (const entry of selected) {
          const ok = await confirmImportOne(entry);
          if (!ok) {
            skipped += 1;
            continue;
          }
          if (await importOneKmEntry(entry)) imported += 1;
        }
        await finishKmImport(imported, skipped, selected.length);
      } catch (e) {
        console.warn("[Import] Key Manager wallet import failed:", e);
        toast.show("Couldn't import Key Manager wallets. Please try again.", "error");
      } finally {
        setKmImportBusy(false);
      }
    })();
  };

  /** Import All: no per-wallet dialogs — import every candidate after this tap. */
  const onImportAllKm = () => {
    void (async () => {
      if (kmImportBusy) return;
      if (!kmPlusAccess) {
        toast.show(
          "Importing Key Manager wallets requires Plus or higher. Upgrade in Settings → Test Tier Selection.",
          "info",
        );
        return;
      }
      if (kmCandidates.length === 0) {
        toast.show("Select at least one wallet to import.", "info");
        return;
      }
      setKmImportBusy(true);
      try {
        let imported = 0;
        for (const entry of kmCandidates) {
          if (await importOneKmEntry(entry)) imported += 1;
        }
        await finishKmImport(imported, 0, kmCandidates.length);
      } catch (e) {
        console.warn("[Import] Key Manager wallet import failed:", e);
        toast.show("Couldn't import Key Manager wallets. Please try again.", "error");
      } finally {
        setKmImportBusy(false);
      }
    })();
  };

  const confirmImportOne = (entry: KeyManagerEntry): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        "Import wallet?",
        `Add "${entry.label}" (${shortenAddress(entry.publicAddress, 6, 4)}) to your wallet switcher?\n\nThe seed stays in Key Manager — it will not be shown.`,
        [
          { text: "Skip", style: "cancel", onPress: () => resolve(false) },
          { text: "Import", onPress: () => resolve(true) },
        ],
      );
    });

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="import-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          testID="import-back-button"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Restore wallet</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAwareScrollView
        ScrollViewComponent={RNScrollView as any}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={60}
      >
        <Card padded status="locked">
          <View style={styles.iconCircle}>
            <Feather name="rotate-ccw" size={20} color={colors.teal} />
          </View>
          <Text style={styles.h2}>Enter your seed or phrase</Text>
          <Text style={styles.p}>
            Paste a 12/24-word recovery phrase, or a 56-character Stellar secret
            key (starts with{" "}
            <Text style={{ color: colors.teal, fontWeight: "700" }}>S</Text>).
          </Text>
        </Card>

        <Card
          padded
          status="locked"
          style={{ marginTop: spacing.md }}
          testID="import-wallet-compat-card"
        >
          <View style={styles.compatHeader}>
            <Feather name="git-branch" size={16} color={colors.teal} />
            <Text style={styles.compatTitle}>Works with your existing wallet</Text>
          </View>
          <Text style={styles.compatBody}>
            Use the same phrase or secret from{" "}
            <Text style={styles.compatStrong}>LOBSTR</Text>,{" "}
            <Text style={styles.compatStrong}>Freighter</Text>, or any SEP-0005
            Stellar wallet. Your account, balances, and trustlines restore
            instantly.
          </Text>
          <Text style={styles.compatHint}>
            In LOBSTR: Settings → Security → Show secret key / recovery phrase.{"\n"}
            In Freighter: Settings → Show recovery phrase / Account secret key.
          </Text>
        </Card>

        <Card
          padded
          style={{ marginTop: spacing.md }}
          testID="import-security-reassurance-card"
        >
          <View style={styles.compatHeader}>
            <Feather name="shield" size={16} color={colors.teal} />
            <Text style={styles.compatTitle}>Your seed never leaves this device</Text>
          </View>
          <Text style={styles.compatBody}>
            Stored only in your device&apos;s secure storage. Never transmitted
            to any server. Only your public key is shared. Anyone with this
            seed controls your funds — never enter it on an untrusted device
            or share it with anyone, including support.
          </Text>
        </Card>

        <View style={styles.labelRow}>
          <Text style={styles.label}>
            {isPhrase ? "RECOVERY PHRASE" : "SECRET SEED OR PHRASE"}
          </Text>
        </View>
        <TextInput
          testID="import-secret-input"
          value={seed}
          onChangeText={setSeed}
          placeholder="S… secret seed, or 12/24-word recovery phrase"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize={isPhrase ? "none" : "characters"}
          autoCorrect={false}
          spellCheck={false}
          secureTextEntry={false}
          style={[styles.input, { fontFamily: undefined, ...typography.mono }]}
          multiline
        />
        <View style={styles.pasteHintRow}>
          <TouchableOpacity
            onPress={handlePaste}
            style={styles.pasteBar}
            testID="import-paste-bar"
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Paste secret seed or recovery phrase from clipboard"
          >
            <Feather name="clipboard" size={14} color={colors.teal} />
            <Text style={styles.pasteBarText}>
              Paste from clipboard
            </Text>
          </TouchableOpacity>
          <Text style={styles.hint}>
            {isPhrase
              ? `${normalizeMnemonic(trimmed).split(" ").filter(Boolean).length} words`
              : `${cleanSeed.length}/56`}
          </Text>
        </View>

        <View style={styles.labelRow}>
          <Text style={styles.label}>WALLET NAME</Text>
        </View>
        <TextInput
          testID="import-nickname-input"
          value={nickname}
          onChangeText={setNickname}
          placeholder="e.g. Savings"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          maxLength={40}
          autoCapitalize="words"
          autoCorrect={false}
        />
        {recognized ? (
          <View style={styles.recognizedRow} testID="import-recognized-hint">
            <Feather name="check-circle" size={13} color={colors.teal} />
            <Text style={styles.recognizedText}>
              Recognized from your saved contacts — feel free to rename it.
            </Text>
          </View>
        ) : (
          <Text style={styles.hint}>Leave blank to import as &quot;Imported Wallet&quot;.</Text>
        )}

        {previewAddress ? (
          <Card padded style={{ marginTop: spacing.md }} status="unlocked">
            <Text style={styles.eyebrow}>DERIVED ADDRESS</Text>
            <Text style={styles.address} numberOfLines={1}>
              {shortenAddress(previewAddress, 10, 10)}
            </Text>
          </Card>
        ) : null}

        <Card padded style={{ marginTop: spacing.md, borderColor: colors.danger, borderWidth: 1 }}>
          <View style={styles.warnRow}>
            <Feather name="alert-triangle" size={16} color={colors.danger} />
            <Text style={styles.warnText}>
              Anyone with this seed controls your vaults. Never type it on a device
              you don&apos;t trust. Never share it with support staff.
            </Text>
          </View>
        </Card>

        <View style={{ height: spacing.lg }} />

        <Button
          testID="import-submit-button"
          label="Restore wallet"
          icon="check"
          onPress={handleImport}
          disabled={!looksValid}
          loading={busy}
        />
      </KeyboardAwareScrollView>

      <Modal
        visible={restorePromptVisible}
        transparent
        animationType="fade"
        onRequestClose={onSkipRestore}
        testID="import-restore-prompt"
      >
        <View style={styles.restoreRoot}>
          <Pressable
            style={styles.restoreBackdrop}
            onPress={restoreBusy ? undefined : onSkipRestore}
            testID="import-restore-backdrop"
          />
          <View style={styles.restoreCard} testID="import-restore-card">
            <View style={styles.restoreIconCircle}>
              <Feather name="hard-drive" size={20} color={colors.teal} />
            </View>
            <Text style={styles.restoreTitle}>Restore saved data?</Text>
            <Text style={styles.restoreBody}>
              You can import a .stvault backup file to restore your contacts,
              keys, and settings.
            </Text>
            <TouchableOpacity
              style={[
                styles.restorePrimaryBtn,
                restoreBusy && styles.restoreBtnDisabled,
              ]}
              onPress={() => {
                void onImportBackup();
              }}
              disabled={restoreBusy}
              activeOpacity={0.85}
              testID="import-restore-import-backup"
              accessibilityRole="button"
            >
              {restoreBusy ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <>
                  <Feather name="upload" size={14} color={colors.textInverse} />
                  <Text style={styles.restorePrimaryText}>Import Backup</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.restoreSkipBtn}
              onPress={onSkipRestore}
              disabled={restoreBusy}
              activeOpacity={0.85}
              testID="import-restore-skip"
              accessibilityRole="button"
            >
              <Text style={styles.restoreSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={kmImportVisible}
        transparent
        animationType="fade"
        onRequestClose={onSkipKmImport}
        testID="import-km-prompt"
      >
        <View style={styles.restoreRoot}>
          <Pressable
            style={styles.restoreBackdrop}
            onPress={kmImportBusy ? undefined : onSkipKmImport}
            testID="import-km-backdrop"
          />
          <View style={styles.restoreCard} testID="import-km-card">
            <View style={styles.restoreIconCircle}>
              <Feather name="key" size={20} color={colors.teal} />
            </View>
            <Text style={styles.restoreTitle}>
              We found {kmCandidates.length} saved wallet
              {kmCandidates.length === 1 ? "" : "s"} in your Key Manager
            </Text>
            <Text style={styles.restoreBody}>
              Import All adds every wallet in one tap. Import Selected asks you to
              confirm each checked wallet. Seeds stay encrypted — nothing is shown
              on screen.
            </Text>
            <RNScrollView
              style={styles.kmList}
              contentContainerStyle={styles.kmListContent}
              nestedScrollEnabled
            >
              <TouchableOpacity
                style={styles.kmSelectAllRow}
                onPress={toggleKmAll}
                activeOpacity={kmPlusAccess ? 0.85 : 1}
                disabled={!kmPlusAccess || kmImportBusy}
                testID="import-km-select-all"
                accessibilityRole="button"
                accessibilityLabel={kmAllChecked ? "Deselect all wallets" : "Select all wallets"}
                accessibilityState={{ checked: kmAllChecked, disabled: !kmPlusAccess || kmImportBusy }}
              >
                <View style={styles.kmSelectAllCheck}>
                  <Checkbox
                    checked={kmAllChecked}
                    onChange={() => toggleKmAll()}
                    disabled={!kmPlusAccess || kmImportBusy}
                    testID="import-km-check-all"
                    accessibilityLabel="Select all wallets from Key Manager"
                  />
                </View>
                <Text style={styles.kmSelectAllText}>
                  {kmAllChecked ? "All wallets selected" : "Select all"}
                </Text>
                <Text style={styles.kmSelectAllCount}>
                  {kmSelected.size}/{kmCandidates.length}
                </Text>
              </TouchableOpacity>
              {kmCandidates.map((entry) => {
                const checked = kmSelected.has(entry.id);
                return (
                  <TouchableOpacity
                    key={entry.id}
                    style={styles.kmRow}
                    onPress={() => toggleKmWallet(entry.id)}
                    activeOpacity={kmPlusAccess ? 0.85 : 1}
                    disabled={!kmPlusAccess || kmImportBusy}
                    testID={`import-km-row-${entry.id}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: !kmPlusAccess || kmImportBusy }}
                  >
                    <View style={styles.kmRowCheck}>
                      <Checkbox
                        checked={checked}
                        onChange={() => toggleKmWallet(entry.id)}
                        disabled={!kmPlusAccess || kmImportBusy}
                        testID={`import-km-check-${entry.id}`}
                        accessibilityLabel={`${checked ? "Deselect" : "Select"} ${entry.label}`}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.kmRowLabel} numberOfLines={1}>
                        {entry.label}
                      </Text>
                      <Text style={styles.kmRowAddr} numberOfLines={1}>
                        {shortenAddress(entry.publicAddress, 8, 6)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </RNScrollView>
            <TouchableOpacity
              style={[
                styles.restorePrimaryBtn,
                (!kmPlusAccess || kmImportBusy) && styles.restoreBtnDisabled,
              ]}
              onPress={() => {
                void onImportAllKm();
              }}
              disabled={kmImportBusy}
              activeOpacity={kmPlusAccess ? 0.85 : 1}
              testID="import-km-import-all"
              accessibilityRole="button"
              accessibilityState={{
                disabled: !kmPlusAccess || kmImportBusy,
              }}
            >
              {kmImportBusy ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <>
                  <Feather
                    name={kmPlusAccess ? "layers" : "lock"}
                    size={14}
                    color={colors.textInverse}
                  />
                  <Text style={styles.restorePrimaryText}>
                    {kmPlusAccess
                      ? `Import All (${kmCandidates.length})`
                      : "Import All · Plus+"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.kmSecondaryBtn,
                (kmImportBusy || kmSelected.size === 0) && styles.restoreBtnDisabled,
              ]}
              onPress={() => {
                void onImportSelectedKm();
              }}
              disabled={kmImportBusy || kmSelected.size === 0}
              activeOpacity={0.85}
              testID="import-km-import-selected"
              accessibilityRole="button"
              accessibilityState={{
                disabled: !kmPlusAccess || kmImportBusy || kmSelected.size === 0,
              }}
            >
              {kmImportBusy ? null : (
                <Feather name="download" size={14} color={colors.cyan} />
              )}
              <Text style={styles.kmSecondaryText}>
                {kmPlusAccess
                  ? `Import Selected${kmSelected.size > 0 ? ` (${kmSelected.size})` : ""}`
                  : "Import Selected · Plus+"}
              </Text>
            </TouchableOpacity>
            {!kmPlusAccess ? (
              <Text style={styles.kmUpgradeHint} testID="import-km-upgrade-hint">
                Plus and up · Upgrade in Settings to unlock multi-wallet import
              </Text>
            ) : null}
            <TouchableOpacity
              style={styles.restoreSkipBtn}
              onPress={onSkipKmImport}
              disabled={kmImportBusy}
              activeOpacity={0.85}
              testID="import-km-skip"
              accessibilityRole="button"
            >
              <Text style={styles.restoreSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
  },
  back: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.text, fontSize: 16, ...typography.heading },
  body: { padding: spacing.md },

  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  h2: { color: colors.text, fontSize: 20, ...typography.heading, marginBottom: 6 },
  p: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

  label: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
  },
  hint: { color: colors.textTertiary, fontSize: 11, marginTop: 6, marginLeft: 4 },

  recognizedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    marginLeft: 4,
  },
  recognizedText: { color: colors.teal, fontSize: 11, flex: 1 },

  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pasteHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  pasteBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  pasteBarText: {
    color: colors.teal,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  eyebrow: { color: colors.gold, fontSize: 10, ...typography.label, marginBottom: 6 },
  address: { color: colors.text, fontSize: 13, ...typography.mono },

  warnRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  warnText: { color: colors.textSecondary, flex: 1, fontSize: 13, lineHeight: 18 },

  compatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: spacing.sm,
  },
  compatTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    flex: 1,
  },
  compatBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  compatHint: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  compatStrong: {
    color: colors.text,
    fontWeight: "700",
  },

  restoreRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  restoreBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  restoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    gap: spacing.sm,
  },
  restoreIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  restoreTitle: {
    color: colors.text,
    fontSize: 18,
    ...typography.heading,
    textAlign: "center",
  },
  restoreBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: spacing.sm,
  },
  restorePrimaryBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.md,
    backgroundColor: colors.teal,
  },
  restoreBtnDisabled: { opacity: 0.6 },
  restorePrimaryText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: "700",
  },
  restoreSkipBtn: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  restoreSkipText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  kmList: {
    width: "100%",
    maxHeight: 220,
    marginBottom: spacing.sm,
  },
  kmListContent: {
    gap: 8,
  },
  kmSelectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  kmSelectAllCheck: {
    marginTop: -4,
  },
  kmSelectAllText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
  kmSelectAllCount: {
    color: colors.textTertiary,
    fontSize: 12,
    ...typography.mono,
  },
  kmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  kmRowCheck: {
    marginTop: -4,
  },
  kmSecondaryBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.surfaceElevated,
  },
  kmSecondaryText: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: "700",
  },
  kmRowLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  kmRowAddr: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
    ...typography.mono,
  },
  kmUpgradeHint: {
    color: colors.gold,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16,
  },
});
