// WalletManagerCard.
//
// Settings-mounted panel that lists every wallet in the book, lets the
// user rename, switch, or delete any of them, and offers two "add"
// affordances: mint a fresh burner OR import from a `S...` secret seed.
//
// Design intent:
//   - Zero-friction switching (single tap to activate any wallet).
//   - Rename is inline (long-press or tap edit icon), no modal.
//   - Deleting a wallet is behind a simple confirm dialog (user
//     preference — no seed re-entry required).
//   - Add-wallet flow is inline (mini form) so the user never leaves
//     the Settings scroll position.

import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { setWalletMnemonic } from "@/src/security/session-keystore";
import { promptSaveWalletToKeyManager } from "@/src/wallet/key-manager-wallet-sync";
import {
  InvalidMnemonicError,
  isValidMnemonic,
  keypairFromMnemonic,
  looksLikeMnemonic,
  normalizeMnemonic,
} from "@/src/wallet/seed-phrase";
import {
  shortenAddress,
  keypairFromSecretSeed,
  InvalidSecretSeedError,
} from "@/src/wallet/stellar";
import {
  loadKeypair,
  type WalletMeta,
} from "@/src/wallet/wallet-book";

type AddMode = null | "burner" | "import";

export function WalletManagerCard() {
  const {
    wallets,
    activeWalletId,
    addBurnerWallet,
    addImportedWallet,
    switchWallet,
    renameWallet,
    removeWallet,
  } = useSession();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const [addMode, setAddMode] = useState<AddMode>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [recognized, setRecognized] = useState(false);
  // Lets the auto-lookup effect below check "did the user already
  // type a name?" without re-running itself on every keystroke of its
  // own auto-fill.
  const newLabelRef = useRef(newLabel);
  useEffect(() => {
    newLabelRef.current = newLabel;
  }, [newLabel]);

  // Wallet Nickname Auto-Lookup — while the "Import" mini-form is
  // open, as soon as the pasted secret/phrase resolves to a valid
  // keypair, check whether this exact public key already has a
  // nickname saved from a previous session (e.g. an Address Book
  // contact) and pre-fill the name field with it instead of leaving
  // it blank.
  useEffect(() => {
    if (addMode !== "import") {
      setRecognized(false);
      return;
    }
    const trimmed = newSecret.trim();
    const phrase = looksLikeMnemonic(trimmed);
    const seed = trimmed.replace(/\s+/g, "").toUpperCase();
    const usable =
      (phrase && isValidMnemonic(trimmed)) ||
      (seed.length === 56 && seed.startsWith("S"));
    if (!usable) {
      setRecognized(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const kp = phrase
          ? keypairFromMnemonic(trimmed)
          : keypairFromSecretSeed(seed);
        const { suggestLabelForPublicKey } = await import(
          "@/src/wallet/wallet-book"
        );
        const found = await suggestLabelForPublicKey(kp.publicKey);
        if (cancelled) return;
        if (found) {
          setRecognized(true);
          if (!newLabelRef.current.trim()) setNewLabel(found);
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
  }, [addMode, newSecret]);

  // Rename modal state (kept lightweight — a single lifted-input row).
  const [renaming, setRenaming] = useState<WalletMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const resetAdd = () => {
    setAddMode(null);
    setNewLabel("");
    setNewSecret("");
    setRecognized(false);
  };

  const onCreate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (addMode === "burner") {
        const requestedLabel = newLabel.trim() || "New Wallet";
        const created = await addBurnerWallet(requestedLabel);
        if (created.label !== requestedLabel) {
          toast.show(
            `Wallet created as "${created.label}" (name was taken).`,
            "success",
          );
        } else {
          toast.show("Burner wallet created and set active", "success");
        }
        const kp = await loadKeypair(created.id);
        if (kp) {
          const result = await promptSaveWalletToKeyManager({
            label: created.label,
            secretSeed: kp.secretSeed,
            publicAddress: kp.publicKey,
          });
          if (result === "saved") {
            toast.show("Saved to Key Manager", "success");
          }
        }
      } else if (addMode === "import") {
        // Pass the trimmed label through as-is (may be empty) so the
        // wallet-book helper can auto-lookup a saved nickname for this
        // public key when the user hasn't typed one themselves.
        // Phrase input is derived to S… first, then the same import path.
        const requestedLabel = newLabel.trim();
        const trimmed = newSecret.trim();
        let secretForImport = trimmed.replace(/\s+/g, "").toUpperCase();
        let mnemonicToStore: string | null = null;
        if (looksLikeMnemonic(trimmed)) {
          const mnemonic = normalizeMnemonic(trimmed);
          secretForImport = keypairFromMnemonic(mnemonic).secretSeed;
          mnemonicToStore = mnemonic;
        }
        const { meta, wasAlreadyImported, autoMatchedLabel } = await addImportedWallet(
          requestedLabel,
          secretForImport,
        );
        if (mnemonicToStore) {
          await setWalletMnemonic(meta.id, mnemonicToStore);
        }
        if (wasAlreadyImported) {
          toast.show(
            `This wallet is already in your list as "${meta.label}". Switched to it.`,
            "success",
          );
        } else if (autoMatchedLabel) {
          toast.show(
            `We recognized this address — welcomed back as "${meta.label}".`,
            "success",
          );
        } else if (requestedLabel && meta.label !== requestedLabel) {
          toast.show(
            `Wallet imported as "${meta.label}" (name was taken).`,
            "success",
          );
        } else {
          toast.show(`Wallet imported as "${meta.label}"`, "success");
        }
        if (!wasAlreadyImported) {
          const result = await promptSaveWalletToKeyManager({
            label: meta.label,
            secretSeed: secretForImport,
            publicAddress: meta.publicKey,
            seedPhrase: mnemonicToStore ?? undefined,
          });
          if (result === "saved") {
            toast.show("Saved to Key Manager", "success");
          }
        }
      }
      resetAdd();
    } catch (err) {
      if (err instanceof InvalidMnemonicError) {
        toast.show(
          "That doesn't look like a valid recovery phrase. Check the words and try again.",
          "error",
        );
      } else if (err instanceof InvalidSecretSeedError) {
        toast.show(
          "That doesn't look like a valid Stellar secret seed. Double-check the 56-character key (starts with S).",
          "error",
        );
      } else if (err instanceof Error) {
        toast.show(err.message, "error");
      } else {
        toast.show("Couldn't add wallet — try again.", "error");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, addMode, newLabel, newSecret, addBurnerWallet, addImportedWallet, toast]);

  const onSwitch = useCallback(
    async (id: string) => {
      if (id === activeWalletId) return;
      try {
        await switchWallet(id);
        toast.show("Active wallet switched", "success");
      } catch {
        toast.show("Couldn't switch wallet", "error");
      }
    },
    [activeWalletId, switchWallet, toast],
  );

  const openRename = useCallback((w: WalletMeta) => {
    setRenaming(w);
    setRenameValue(w.label);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming.label) {
      setRenaming(null);
      return;
    }
    try {
      const finalLabel = await renameWallet(renaming.id, next);
      if (finalLabel && finalLabel !== next) {
        toast.show(
          `Renamed to "${finalLabel}" (name was taken).`,
          "success",
        );
      } else {
        toast.show("Wallet renamed", "success");
      }
    } catch {
      toast.show("Couldn't rename wallet", "error");
    } finally {
      setRenaming(null);
    }
  }, [renaming, renameValue, renameWallet, toast]);

  const onDelete = useCallback(
    (w: WalletMeta) => {
      if (wallets.length <= 1) {
        toast.show(
          "You can't delete your only wallet. Use Disconnect wallet in Settings instead.",
          "info",
        );
        return;
      }
      Alert.alert(
        `Delete "${w.label}"?`,
        "The stored secret seed for this wallet will be wiped from this device. If you haven't backed it up, this is irreversible.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await removeWallet(w.id);
                toast.show("Wallet deleted", "success");
              } catch {
                toast.show("Couldn't delete wallet", "error");
              }
            },
          },
        ],
      );
    },
    [wallets.length, removeWallet, toast],
  );

  return (
    <>
      <Card padded>
        {wallets.length === 0 ? (
          <View style={styles.emptyRow}>
            <Feather name="credit-card" size={16} color={colors.textTertiary} />
            <Text style={styles.emptyText}>
              No wallets yet. Add one below to get started.
            </Text>
          </View>
        ) : (
          wallets.map((w, idx) => {
            const active = w.id === activeWalletId;
            return (
              <View
                key={w.id}
                style={[styles.row, idx > 0 && styles.rowDivider]}
                testID={`wallet-manager-row-${w.id}`}
              >
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={0.7}
                  onPress={() => onSwitch(w.id)}
                  testID={`wallet-manager-activate-${w.id}`}
                >
                  <View style={[styles.dot, active && styles.dotOn]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.labelRow}>
                      <Text style={styles.label} numberOfLines={1}>
                        {w.label}
                      </Text>
                      {active ? (
                        <View style={styles.activeBadge}>
                          <Text style={styles.activeBadgeText}>ACTIVE</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.address} numberOfLines={1}>
                      {shortenAddress(w.publicKey, 8, 6)}
                    </Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.rowActions}>
                  <TouchableOpacity
                    onPress={() => openRename(w)}
                    hitSlop={10}
                    style={styles.iconBtn}
                    testID={`wallet-manager-rename-${w.id}`}
                    accessibilityLabel={`Rename ${w.label}`}
                  >
                    <Feather name="edit-2" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => onDelete(w)}
                    hitSlop={10}
                    style={styles.iconBtn}
                    testID={`wallet-manager-delete-${w.id}`}
                    accessibilityLabel={`Delete ${w.label}`}
                  >
                    <Feather name="trash-2" size={14} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        <View style={styles.addStrip}>
          {addMode === null ? (
            <View style={styles.addBtnRow}>
              <Button
                testID="wallet-manager-add-burner"
                label={"Generate\nKeypair"}
                icon="plus"
                variant="secondary"
                onPress={() => setAddMode("burner")}
                style={{ flex: 1 }}
                numberOfLines={2}
              />
              <View style={{ width: spacing.sm }} />
              <Button
                testID="wallet-manager-add-import"
                label="Import"
                icon="download"
                variant="secondary"
                onPress={() => setAddMode("import")}
                style={{ flex: 1 }}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.formTitle}>
                {addMode === "burner"
                  ? "New burner wallet"
                  : "Import wallet from seed or phrase"}
              </Text>
              <TextInput
                testID="wallet-manager-label-input"
                value={newLabel}
                onChangeText={setNewLabel}
                placeholder="Wallet name (e.g. Savings)"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                maxLength={40}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {recognized ? (
                <View style={styles.recognizedRow} testID="wallet-manager-recognized-hint">
                  <Feather name="check-circle" size={12} color={colors.teal} />
                  <Text style={styles.recognizedText}>
                    Recognized from your saved contacts.
                  </Text>
                </View>
              ) : null}
              {addMode === "import" ? (
                <TextInput
                  testID="wallet-manager-secret-input"
                  value={newSecret}
                  onChangeText={setNewSecret}
                  placeholder="S… secret seed, or 12/24-word phrase"
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.input, { fontFamily: undefined, ...typography.mono }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  secureTextEntry={false}
                  multiline
                />
              ) : (
                <Text style={styles.hint}>
                  A brand-new keypair will be minted on this device. You&apos;ll
                  need to fund it before it can hold assets on Stellar.
                </Text>
              )}
              <View style={{ height: spacing.sm }} />
              <View style={styles.formActions}>
                <Button
                  testID="wallet-manager-add-cancel"
                  label="Cancel"
                  variant="ghost"
                  onPress={resetAdd}
                  style={{ flex: 1 }}
                  disabled={busy}
                />
                <View style={{ width: spacing.sm }} />
                <Button
                  testID="wallet-manager-add-confirm"
                  label={addMode === "burner" ? "Create" : "Import"}
                  icon={busy ? undefined : "check"}
                  onPress={onCreate}
                  style={{ flex: 1 }}
                  disabled={
                    busy ||
                    (addMode === "import" &&
                      !(
                        looksLikeMnemonic(newSecret) ||
                        newSecret.trim().replace(/\s+/g, "").length >= 56
                      ))
                  }
                />
              </View>
              {busy ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator size="small" color={colors.teal} />
                  <Text style={styles.busyText}>Working…</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </Card>

      {/*
        The rename sheet is anchored to the TOP of the screen so the
        Android on-screen keyboard doesn't cover the input while typing.
      */}
      <Modal
        visible={!!renaming}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setRenaming(null)}
          testID="wallet-manager-rename-backdrop"
        />
        <View
          style={[styles.renameSheet, { paddingTop: insets.top + spacing.md }]}
          testID="wallet-manager-rename-sheet"
        >
          <Text style={styles.renameTitle}>Rename wallet</Text>
          <TextInput
            testID="wallet-manager-rename-input"
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Wallet name"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={40}
            onSubmitEditing={commitRename}
          />
          <View style={{ height: spacing.md }} />
          <View style={styles.formActions}>
            <Button
              testID="wallet-manager-rename-cancel"
              label="Cancel"
              variant="ghost"
              onPress={() => setRenaming(null)}
              style={{ flex: 1 }}
            />
            <View style={{ width: spacing.sm }} />
            <Button
              testID="wallet-manager-rename-save"
              label="Save"
              icon="check"
              onPress={commitRename}
              style={{ flex: 1 }}
              disabled={!renameValue.trim()}
            />
          </View>
          {/* Bottom drag handle affordance — hints that the sheet
              can be dismissed by tapping outside. */}
          <View style={styles.sheetHandle} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  emptyText: { color: colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    maxWidth: 180,
  },
  activeBadge: {
    backgroundColor: colors.teal,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: colors.textInverse,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  address: { color: colors.textTertiary, fontSize: 11, ...typography.mono, marginTop: 2 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dotOn: { backgroundColor: colors.teal, borderColor: colors.teal },

  rowActions: { flexDirection: "row", gap: 4 },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },

  addStrip: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  addBtnRow: { flexDirection: "row", alignItems: "stretch" },
  form: {},
  formTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  inputMono: { ...typography.mono, fontSize: 12 },
  recognizedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    marginLeft: 2,
  },
  recognizedText: { color: colors.teal, fontSize: 11 },
  hint: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: spacing.sm,
    lineHeight: 16,
  },
  formActions: { flexDirection: "row", alignItems: "stretch" },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: spacing.sm,
    justifyContent: "center",
  },
  busyText: { color: colors.textSecondary, fontSize: 12 },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  renameSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    padding: spacing.md + 4,
    paddingBottom: spacing.md,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: spacing.md,
  },
  renameTitle: {
    color: colors.text,
    fontSize: 18,
    ...typography.heading,
    marginBottom: spacing.sm,
  },
});
