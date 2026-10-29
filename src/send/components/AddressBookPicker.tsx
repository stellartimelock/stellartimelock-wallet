import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import {
  loadSmartAddresses,
  type SmartAddress,
} from "@/src/send/smart-address-book";
import {
  AddressBookKind,
  AddressBookNetwork,
  isValidAddressForNetwork,
  isValidMemo,
  listEntries,
  removeEntry,
  upsertEntry,
} from "@/src/wallet/address-book";

const KIND_LABEL: Record<AddressBookKind, string> = {
  private: "Private Wallet",
  exchange: "Exchange / Custodial",
  casino: "Casino",
  donation: "Donation",
};
const KIND_ORDER: AddressBookKind[] = ["private", "exchange", "casino", "donation"];

export function AddressBookPicker({
  visible,
  onClose,
  onPick,
  network,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (e: SmartAddress) => void;
  /**
   * Optional network filter. When provided:
   *   • Only entries matching this network are listed
   *   • "Add contact" form validates the address for this network
   *   • Memo field is hidden for Solana (no memo primitive)
   * When omitted, defaults to legacy Stellar-only behaviour.
   */
  network?: AddressBookNetwork;
}) {
  const insets = useSafeAreaInsets();
  const activeNetwork: AddressBookNetwork = network ?? "stellar";
  const [entries, setEntries] = useState<SmartAddress[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [pubKey, setPubKey] = useState("");
  const [memo, setMemo] = useState("");
  const [kind, setKind] = useState<AddressBookKind>(
    activeNetwork === "solana" ? "private" : "exchange",
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (activeNetwork === "solana") {
      const saved = await listEntries("solana");
      setEntries(
        saved.map((entry) => ({
          id: entry.id,
          label: entry.label,
          publicKey: entry.publicKey,
          defaultMemo: entry.defaultMemo,
          kind: entry.kind,
          source: "contact" as const,
          icon: entry.icon,
        })),
      );
      return;
    }
    const rows = await loadSmartAddresses(setEntries);
    setEntries(rows);
  }, [activeNetwork]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const reset = () => {
    setLabel("");
    setPubKey("");
    setMemo("");
    setKind(activeNetwork === "solana" ? "private" : "exchange");
    setError(null);
    setAddOpen(false);
  };

  const onSave = async () => {
    setError(null);
    if (!isValidAddressForNetwork(pubKey, activeNetwork)) {
      setError(
        activeNetwork === "solana"
          ? "Address must be a valid Solana address (32–44 Base58 characters)."
          : "Address must be a 56-char Stellar G… key.",
      );
      return;
    }
    if (activeNetwork === "stellar" && !isValidMemo(memo)) {
      setError("Memo exceeds the 28-byte Stellar text limit.");
      return;
    }
    if (
      activeNetwork === "stellar" &&
      (kind === "exchange" || kind === "casino") &&
      !memo.trim()
    ) {
      setError(
        "A memo is required for exchange and casino contacts. Paste the deposit memo from the platform.",
      );
      return;
    }
    if (label.trim().length === 0) {
      setError("Label is required.");
      return;
    }
    try {
      await upsertEntry({
        label,
        publicKey: pubKey,
        defaultMemo: activeNetwork === "solana" ? "" : memo,
        kind,
        network: activeNetwork,
      });
      reset();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (entry: SmartAddress) => {
    if (entry.source !== "contact") return;
    await removeEntry(entry.id);
    await refresh();
  };

  const bookRows = entries;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[styles.sheet, { paddingTop: insets.top + spacing.sm }]}
        testID="address-book-sheet"
      >
        <View style={styles.headerRow}>
          <Feather name="book-open" size={18} color={colors.teal} />
          <Text style={styles.title}>
            Address Book
            {network ? ` · ${activeNetwork === "solana" ? "Solana" : "Stellar"}` : ""}
          </Text>
          <TouchableOpacity onPress={onClose} testID="address-book-close" style={styles.iconBtn}>
            <Feather name="x" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sub}>
          {activeNetwork === "solana"
            ? "Saved Solana destinations. Used by the Buy XLM (SOL→XLM) swap flow."
            : "Contacts, your wallets, and saved keys. Public addresses only. Memos auto-fill for exchange and casino deposits."}
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {bookRows.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="users" size={22} color={colors.textTertiary} />
              <Text style={styles.emptyText}>
                {activeNetwork === "solana" ? "No saved contacts yet." : "No saved addresses yet."}
              </Text>
            </View>
          ) : (
            bookRows.map((e) => (
              <View key={e.id} style={styles.row} testID={`address-book-row-${e.id}`}>
                <TouchableOpacity
                  style={styles.rowMain}
                  activeOpacity={0.7}
                  onPress={() => onPick(e)}
                  testID={`address-book-pick-${e.id}`}
                >
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {e.label}
                  </Text>
                  <Text style={styles.rowAddr} numberOfLines={1}>
                    {e.publicKey.slice(0, 8)}…{e.publicKey.slice(-6)}
                  </Text>
                  <View style={styles.rowMetaRow}>
                    <View style={styles.kindPill}>
                      <Text style={styles.kindPillText}>
                        {e.source === "wallet"
                          ? "Wallet"
                          : e.source === "key"
                            ? "Saved key"
                            : e.source === "vault"
                              ? "Vault"
                              : KIND_LABEL[e.kind]}
                      </Text>
                    </View>
                    {e.defaultMemo ? (
                      <Text style={styles.memoChip} numberOfLines={1}>
                        memo: {e.defaultMemo}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
                {e.source === "contact" ? (
                  <TouchableOpacity
                    onPress={() => onDelete(e)}
                    style={styles.iconBtn}
                    testID={`address-book-delete-${e.id}`}
                    accessibilityLabel={`Delete ${e.label}`}
                  >
                    <Feather name="trash-2" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.iconBtn} />
                )}
              </View>
            ))
          )}
        </ScrollView>

        {addOpen ? (
          <View style={styles.addCard} testID="address-book-add-card">
            <Text style={styles.addTitle}>New contact</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Label (e.g. Binance XLM Deposit)"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="address-book-label-input"
              maxLength={32}
            />
            <TextInput
              value={pubKey}
              onChangeText={setPubKey}
              placeholder={
                activeNetwork === "solana"
                  ? "Solana address (32–44 Base58 chars)"
                  : "G… (56-char Stellar address)"
              }
              autoCapitalize={activeNetwork === "solana" ? "none" : "characters"}
              autoCorrect={false}
              spellCheck={false}
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              testID="address-book-pubkey-input"
            />
            {activeNetwork === "stellar" ? (
              <View style={{ width: "100%" }}>
                <Text
                  style={
                    kind === "exchange" || kind === "casino"
                      ? styles.memoLabelRequired
                      : styles.memoLabel
                  }
                  testID="address-book-memo-label"
                >
                  Memo{" "}
                  {kind === "exchange" || kind === "casino"
                    ? "(Required)"
                    : "(Optional)"}
                </Text>
                <TextInput
                  value={memo}
                  onChangeText={setMemo}
                  placeholder={
                    kind === "exchange" || kind === "casino"
                      ? "Memo REQUIRED — paste the deposit memo from the platform"
                      : "Default memo (optional, 28-byte max)"
                  }
                  placeholderTextColor={colors.textTertiary}
                  style={[
                    styles.input,
                    (kind === "exchange" || kind === "casino") &&
                      !memo.trim() &&
                      styles.inputRequiredEmpty,
                  ]}
                  testID="address-book-memo-input"
                  maxLength={28}
                />
              </View>
            ) : null}
            <View style={styles.kindRow}>
              {KIND_ORDER.map((k) => {
                const active = k === kind;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => setKind(k)}
                    style={[styles.kindChoice, active && styles.kindChoiceActive]}
                    testID={`address-book-kind-${k}`}
                  >
                    <Text
                      style={[
                        styles.kindChoiceText,
                        active && styles.kindChoiceTextActive,
                      ]}
                    >
                      {KIND_LABEL[k]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {activeNetwork === "stellar" &&
            (kind === "exchange" || kind === "casino") &&
            !memo.trim() ? (
              <View style={styles.memoWarnBanner} testID="address-book-memo-warn">
                <Text style={styles.memoWarnText}>
                  {"\u26A0\uFE0F This address requires a memo. Please enter the memo provided by the platform to ensure your funds are not lost."}
                </Text>
              </View>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.addActions}>
              <TouchableOpacity
                onPress={reset}
                style={[styles.addBtn, styles.addBtnGhost]}
                testID="address-book-cancel"
              >
                <Text style={styles.addBtnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onSave}
                disabled={
                  activeNetwork === "stellar" &&
                  (kind === "exchange" || kind === "casino") &&
                  !memo.trim()
                }
                style={[
                  styles.addBtn,
                  styles.addBtnPrimary,
                  activeNetwork === "stellar" &&
                    (kind === "exchange" || kind === "casino") &&
                    !memo.trim() &&
                    styles.addBtnDisabled,
                ]}
                testID="address-book-save"
              >
                <Text style={styles.addBtnPrimaryText}>
                  {activeNetwork === "stellar" &&
                  (kind === "exchange" || kind === "casino") &&
                  !memo.trim()
                    ? "Memo required"
                    : "Save contact"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setAddOpen(true)}
            style={styles.openAddBtn}
            testID="address-book-open-add"
            activeOpacity={0.85}
          >
            <Feather name="plus" size={16} color={colors.teal} />
            <Text style={styles.openAddText}>Add new contact</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    position: "absolute", left: 0, right: 0, top: 0,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md,
    maxHeight: "85%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  sheetHandle: {
    width: 40, height: 4, backgroundColor: colors.border,
    borderRadius: 2, alignSelf: "center", marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginBottom: spacing.xs,
  },
  title: { color: colors.text, fontSize: 18, ...typography.heading, flex: 1 },
  sub: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
    marginBottom: spacing.xs,
  },
  sectionSpace: { marginTop: spacing.sm },
  favoritesEmpty: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  favoritesEnable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.goldMuted,
  },
  favoritesEnableText: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  phoneMessage: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  favAdd: { marginTop: -4, marginBottom: spacing.sm, gap: spacing.sm },
  scroll: { maxHeight: 300 },
  scrollContent: { paddingBottom: spacing.sm },
  empty: {
    alignItems: "center",
    gap: 8,
    paddingVertical: spacing.lg,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderRadius: radii.md,
  },
  emptyText: { color: colors.textSecondary, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 72,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  rowMain: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  rowAddr: { color: colors.textSecondary, fontSize: 11, ...typography.mono, marginTop: 2 },
  rowMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  kindPill: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.tealMuted,
  },
  kindPillText: { color: colors.teal, fontSize: 10, fontWeight: "700" },
  memoChip: {
    flex: 1, color: colors.gold, fontSize: 10,
    ...typography.mono, opacity: 0.85,
  },
  iconBtn: {
    width: 36, height: 36,
    alignItems: "center", justifyContent: "center",
    borderRadius: radii.sm,
  },
  openAddBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.tealMuted,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.teal,
  },
  openAddText: { color: colors.teal, fontSize: 13, fontWeight: "700" },
  addCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderRadius: radii.md,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  addTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  input: {
    color: colors.text, fontSize: 13,
    backgroundColor: colors.surface,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  inputRequiredEmpty: {
    borderColor: colors.warning,
    borderWidth: 1,
  },
  memoLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  memoLabelRequired: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  kindChoice: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  kindChoiceActive: { backgroundColor: colors.cyanMuted, borderColor: colors.cyan },
  kindChoiceText: { color: colors.textSecondary, fontSize: 11 },
  kindChoiceTextActive: { color: colors.cyan, fontWeight: "700" },
  errorText: { color: colors.danger, fontSize: 12 },
  addActions: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  addBtn: {
    flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center",
    borderRadius: radii.sm,
  },
  addBtnGhost: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  addBtnGhostText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  addBtnPrimary: { backgroundColor: colors.teal },
  addBtnPrimaryText: { color: colors.textInverse, fontSize: 13, fontWeight: "700" },
  addBtnDisabled: {
    backgroundColor: colors.dangerMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
    opacity: 0.85,
  },
  memoWarnBanner: {
    backgroundColor: colors.goldMuted,
    borderColor: colors.gold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: 10,
    marginTop: 4,
  },
  memoWarnText: {
    color: colors.gold,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
});
