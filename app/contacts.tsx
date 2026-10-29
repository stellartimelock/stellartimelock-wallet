// Replaces the "Add contact via Send" flow. Users manage every saved
// contact (add / edit / delete) here. The Send screen still uses the
// AddressBookPicker for one-tap fill, but it no longer offers "save
// this address" as an inline action.
//
// Two tabs: Stellar and Solana. Solana entries are used by the
// Buy-XLM (SOL→XLM) swap flow for refund + destination addresses;
// Stellar entries feed the standard Send flow.

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { useToast } from "@/src/components/Toast";
import {
  entryNetwork,
  isValidAddressForNetwork,
  isValidMemo,
  listEntries,
  removeEntry,
  upsertEntry,
  type AddressBookEntry,
  type AddressBookKind,
  type AddressBookNetwork,
} from "@/src/wallet/address-book";
import { shortenAddress } from "@/src/wallet/stellar";
import { colors, radii, spacing, typography } from "@/src/theme";

/** Feather icons offered in the contact editor. */
const CONTACT_ICONS: Array<{
  name: keyof typeof Feather.glyphMap;
  label: string;
}> = [
  { name: "user", label: "Person" },
  { name: "users", label: "Family" },
  { name: "heart", label: "Friend" },
  { name: "home", label: "Home" },
  { name: "briefcase", label: "Business" },
  { name: "credit-card", label: "Wallet" },
  { name: "dollar-sign", label: "Bank" },
  { name: "repeat", label: "Exchange" },
  { name: "star", label: "Casino" },
  { name: "gift", label: "Gift" },
  { name: "globe", label: "Web" },
  { name: "mail", label: "Mail" },
  { name: "phone", label: "Phone" },
  { name: "shield", label: "Secure" },
  { name: "lock", label: "Lock" },
  { name: "key", label: "Key" },
  { name: "bookmark", label: "Saved" },
  { name: "shopping-bag", label: "Shop" },
  { name: "truck", label: "Delivery" },
  { name: "coffee", label: "Cafe" },
  { name: "zap", label: "Fast" },
  { name: "cloud", label: "Cloud" },
  { name: "server", label: "Server" },
  { name: "target", label: "Target" },
];

type EditingState =
  | null
  | {
      network: AddressBookNetwork;
      id?: string;
      label: string;
      publicKey: string;
      defaultMemo: string;
      kind: AddressBookKind;
      icon?: string;
    };

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ tab?: string; new?: string }>();

  const [activeTab, setActiveTab] = useState<AddressBookNetwork>(
    params.tab === "solana" ? "solana" : "stellar",
  );
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [editing, setEditing] = useState<EditingState>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await listEntries();
      setEntries(all);
    } catch (e) {
      console.warn("[Contacts] refresh failed:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-open the new-contact sheet when `?new=1` is passed.
  useEffect(() => {
    if (params.new === "1") {
      openNew(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.new]);

  const filtered = useMemo(
    () => entries.filter((e) => entryNetwork(e) === activeTab),
    [entries, activeTab],
  );

  const openNew = (network: AddressBookNetwork) => {
    setEditing({
      network,
      label: "",
      publicKey: "",
      defaultMemo: "",
      kind: "private",
      icon: undefined,
    });
  };

  const openEdit = (entry: AddressBookEntry) => {
    setEditing({
      network: entryNetwork(entry),
      id: entry.id,
      label: entry.label,
      publicKey: entry.publicKey,
      defaultMemo: entry.defaultMemo,
      kind: entry.kind,
      icon: entry.icon,
    });
  };

  const closeSheet = () => setEditing(null);

  // Address book entries are commonly pasted from another app, unlike
  // seed-import which only ever takes the device's own secret key.
  const handlePasteAddress = async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) {
        toast.show("Clipboard is empty.", "error");
        return;
      }
      setEditing((e) => (e ? { ...e, publicKey: text } : e));
      toast.show("Pasted from clipboard.", "success");
    } catch {
      toast.show("Couldn't read the clipboard.", "error");
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await upsertEntry({
        id: editing.id,
        label: editing.label.trim(),
        publicKey: editing.publicKey.trim(),
        defaultMemo: editing.defaultMemo,
        kind: editing.kind,
        network: editing.network,
        icon: editing.icon,
      });
      await refresh();
      toast.show(editing.id ? "Contact updated" : "Contact saved", "success");
      closeSheet();
    } catch (e) {
      console.warn("[Contacts] save failed:", e);
      toast.show("Save failed. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (entry: AddressBookEntry) => {
    Alert.alert(
      "Remove contact?",
      `${entry.label} will be removed from your address book.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeEntry(entry.id);
              await refresh();
              toast.show("Contact removed", "success");
            } catch (e) {
              console.warn("[Contacts] remove failed:", e);
              toast.show("Remove failed. Please try again.", "error");
            }
          },
        },
      ],
    );
  };

  const addrValid = editing
    ? isValidAddressForNetwork(editing.publicKey.trim(), editing.network)
    : false;
  const memoValid = editing ? isValidMemo(editing.defaultMemo) : true;
  // Stellar exchange / casino contacts require a non-empty memo.
  // Private + donation (and all Solana) keep memo optional.
  const memoRequiredForKind =
    !!editing &&
    editing.network === "stellar" &&
    (editing.kind === "exchange" || editing.kind === "casino");
  const memoPresent = !!editing && editing.defaultMemo.trim().length > 0;
  const canSave =
    !!editing &&
    editing.label.trim().length > 0 &&
    addrValid &&
    memoValid &&
    (!memoRequiredForKind || memoPresent);

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: "Address Book", headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          testID="contacts-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Address Book</Text>
        <TouchableOpacity
          onPress={() => openNew(activeTab)}
          style={styles.headerBtn}
          testID="contacts-new"
        >
          <Feather name="plus" size={22} color={colors.cyan} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabs}>
        <TabPill
          label="Stellar"
          icon="star"
          count={entries.filter((e) => entryNetwork(e) === "stellar").length}
          active={activeTab === "stellar"}
          onPress={() => setActiveTab("stellar")}
          testID="contacts-tab-stellar"
        />
        <TabPill
          label="Solana"
          icon="zap"
          count={entries.filter((e) => entryNetwork(e) === "solana").length}
          active={activeTab === "solana"}
          onPress={() => setActiveTab("solana")}
          testID="contacts-tab-solana"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.tabIntro}>
          {activeTab === "stellar"
            ? "Stellar addresses used by the Send flow. Add exchange, casino, or private-wallet destinations. They stay in this wallet."
            : "Solana addresses used by the Buy XLM (SOL→XLM) swap for refund / destination pre-fill."}
        </Text>

        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Feather name="user-plus" size={26} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No saved contacts yet</Text>
            <Text style={styles.emptyBody}>
              Tap the + button in the header to add your first{" "}
              {activeTab === "stellar" ? "Stellar" : "Solana"} contact.
            </Text>
          </View>
        ) : (
          filtered.map((entry) => (
            <View
              key={entry.id}
              style={[styles.entryCard, { backgroundColor: colors.background }]}
              testID={`contact-card-${entry.id}`}
            >
              <View style={styles.avatar}>
                {entry.icon && entry.icon in Feather.glyphMap ? (
                  <Feather
                    name={entry.icon as keyof typeof Feather.glyphMap}
                    size={16}
                    color={colors.teal}
                  />
                ) : (
                  <Text style={styles.avatarText}>
                    {(entry.label || "?").slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.entryTitleRow}>
                  <Text style={styles.entryLabel} numberOfLines={1}>
                    {entry.label || "Unnamed"}
                  </Text>
                  <View style={styles.kindBadge}>
                    <Text style={styles.kindBadgeText}>
                      {entry.kind.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text
                  style={styles.entryAddr}
                  numberOfLines={1}
                  selectable
                >
                  {shortenAddress(entry.publicKey, 6, 6)}
                </Text>
                {entry.defaultMemo ? (
                  <Text style={styles.entryMemo} numberOfLines={1}>
                    Memo: {entry.defaultMemo}
                  </Text>
                ) : null}
              </View>
              <View style={styles.entryActions}>
                <TouchableOpacity
                  onPress={() => openEdit(entry)}
                  style={styles.iconBtn}
                  testID={`contact-edit-${entry.id}`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Feather name="edit-2" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(entry)}
                  style={styles.iconBtn}
                  testID={`contact-delete-${entry.id}`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Feather name="trash-2" size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {/* Persistent bottom "Add" affordance for tap-friendliness. */}
        <TouchableOpacity
          onPress={() => openNew(activeTab)}
          style={styles.addBtnLarge}
          testID="contacts-add-bottom"
          activeOpacity={0.85}
        >
          <Feather name="plus" size={16} color={colors.cyan} />
          <Text style={styles.addBtnLargeText}>
            Add {activeTab === "stellar" ? "Stellar" : "Solana"} contact
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={closeSheet}
      >
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.sheetKAV}
        >
          <View
            style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}
            testID="contact-editor-sheet"
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: spacing.md }}
            >
              <Text style={styles.sheetTitle}>
                {editing?.id ? "Edit contact" : "New contact"}
                {editing
                  ? ` · ${editing.network === "solana" ? "Solana" : "Stellar"}`
                  : ""}
              </Text>

              <Text style={styles.field}>NAME / LABEL</Text>
              <TextInput
                value={editing?.label ?? ""}
                onChangeText={(v) =>
                  setEditing((e) => (e ? { ...e, label: v } : e))
                }
                placeholder="e.g. Landlord, Kraken Deposit, Personal Cold Wallet"
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                maxLength={32}
                autoFocus
                testID="contact-input-label"
              />

              <Text style={styles.field}>ICON</Text>
              <View style={styles.iconGrid} testID="contact-icon-picker">
                <TouchableOpacity
                  onPress={() =>
                    setEditing((e) => (e ? { ...e, icon: undefined } : e))
                  }
                  style={[
                    styles.iconCell,
                    !editing?.icon && styles.iconCellActive,
                  ]}
                  testID="contact-icon-none"
                  accessibilityLabel="No icon — use first letter"
                >
                  <Text
                    style={[
                      styles.iconCellLetter,
                      !editing?.icon && styles.iconCellLetterActive,
                    ]}
                  >
                    A
                  </Text>
                </TouchableOpacity>
                {CONTACT_ICONS.map((ic) => {
                  const selected = editing?.icon === ic.name;
                  return (
                    <TouchableOpacity
                      key={ic.name}
                      onPress={() =>
                        setEditing((e) =>
                          e ? { ...e, icon: ic.name } : e,
                        )
                      }
                      style={[
                        styles.iconCell,
                        selected && styles.iconCellActive,
                      ]}
                      testID={`contact-icon-${ic.name}`}
                      accessibilityLabel={ic.label}
                    >
                      <Feather
                        name={ic.name}
                        size={16}
                        color={selected ? colors.textInverse : colors.cyan}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.field}>
                {editing?.network === "solana"
                  ? "SOLANA ADDRESS"
                  : "STELLAR ADDRESS"}
              </Text>
              <TextInput
                value={editing?.publicKey ?? ""}
                onChangeText={(v) =>
                  setEditing((e) => (e ? { ...e, publicKey: v } : e))
                }
                placeholder={
                  editing?.network === "solana"
                    ? "Base58 (32-44 characters)"
                    : "G... (56 characters)"
                }
                placeholderTextColor={colors.textTertiary}
                autoCapitalize={editing?.network === "solana" ? "none" : "characters"}
                autoCorrect={false}
                style={[styles.input, styles.inputMono]}
                maxLength={56}
                testID="contact-input-address"
              />
              <TouchableOpacity
                onPress={handlePasteAddress}
                style={styles.pasteBar}
                testID="contact-paste-address-bar"
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Paste address from clipboard"
              >
                <Feather name="clipboard" size={14} color={colors.cyan} />
                <Text style={styles.pasteBarText}>Paste from clipboard</Text>
              </TouchableOpacity>

              <Text style={styles.field}>KIND</Text>
              <View style={styles.kindRow}>
                {(["private", "exchange", "casino", "donation"] as AddressBookKind[]).map(
                  (k) => (
                    <TouchableOpacity
                      key={k}
                      onPress={() =>
                        setEditing((e) => (e ? { ...e, kind: k } : e))
                      }
                      style={[
                        styles.kindChip,
                        editing?.kind === k && styles.kindChipActive,
                      ]}
                      testID={`contact-kind-${k}`}
                    >
                      <Text
                        style={[
                          styles.kindChipText,
                          editing?.kind === k && styles.kindChipTextActive,
                        ]}
                      >
                        {k.charAt(0).toUpperCase() + k.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ),
                )}
              </View>

              {editing?.network === "stellar" ? (
                <>
                  <Text
                    style={[
                      styles.field,
                      memoRequiredForKind && styles.fieldRequired,
                    ]}
                    testID="contact-memo-label"
                  >
                    {memoRequiredForKind ? "MEMO (REQUIRED)" : "MEMO (OPTIONAL)"}
                  </Text>
                  <TextInput
                    value={editing?.defaultMemo ?? ""}
                    onChangeText={(v) =>
                      setEditing((ed) => (ed ? { ...ed, defaultMemo: v } : ed))
                    }
                    placeholder={
                      memoRequiredForKind
                        ? "Memo REQUIRED — paste the deposit memo from the platform"
                        : "Default memo (optional, 28-byte max)"
                    }
                    placeholderTextColor={colors.textTertiary}
                    style={[
                      styles.input,
                      memoRequiredForKind &&
                        !memoPresent &&
                        styles.inputError,
                    ]}
                    maxLength={28}
                    testID="contact-input-memo"
                  />
                  {memoRequiredForKind && !memoPresent ? (
                    <View style={styles.memoWarnBanner} testID="contact-memo-warn">
                      <Text style={styles.memoWarnText}>
                        {"\u26A0\uFE0F This address requires a memo. Please enter the memo provided by the platform to ensure your funds are not lost."}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              <View style={{ height: spacing.md }} />
              <View style={styles.sheetActions}>
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={closeSheet}
                  style={{ flex: 1 }}
                  testID="contact-cancel"
                />
                <View style={{ width: spacing.sm }} />
                <Button
                  label={busy ? "Saving…" : "Save"}
                  icon="check"
                  onPress={save}
                  disabled={!canSave}
                  loading={busy}
                  style={{ flex: 1 }}
                  testID="contact-save"
                />
              </View>
              <View style={styles.sheetHandle} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function TabPill({
  label,
  icon,
  count,
  active,
  onPress,
  testID,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  count: number;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.tabPill, active && styles.tabPillActive]}
      activeOpacity={0.85}
      testID={testID}
    >
      <Feather
        name={icon}
        size={14}
        color={active ? colors.textInverse : colors.textSecondary}
      />
      <Text
        style={[styles.tabPillText, active && styles.tabPillTextActive]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.tabCountPill,
          active && styles.tabCountPillActive,
        ]}
      >
        <Text
          style={[
            styles.tabCountText,
            active && styles.tabCountTextActive,
          ]}
        >
          {count}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerBtn: { padding: 8 },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    ...typography.heading,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  tabPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabPillActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  tabPillText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  tabPillTextActive: { color: colors.textInverse },
  tabCountPill: {
    minWidth: 22,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148, 163, 184, 0.2)",
  },
  tabCountPillActive: {
    backgroundColor: "rgba(11, 15, 25, 0.25)",
  },
  tabCountText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
  },
  tabCountTextActive: { color: colors.textInverse },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  tabIntro: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 2,
    marginBottom: 4,
  },
  emptyCard: {
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 6,
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  entryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 72,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: colors.background,
    overflow: "hidden",
    opacity: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.tealMuted,
    borderWidth: 1,
    borderColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.teal, fontSize: 14, fontWeight: "800" },
  entryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  entryLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(148, 163, 184, 0.15)",
  },
  kindBadgeText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  entryAddr: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    ...typography.mono,
  },
  entryMemo: {
    color: colors.cyan,
    fontSize: 11,
    marginTop: 2,
    fontWeight: "600",
  },
  entryActions: { flexDirection: "row", gap: 2 },
  iconBtn: { padding: 6, borderRadius: 8 },
  addBtnLarge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: spacing.md - 2,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.teal,
    borderStyle: "dashed",
    backgroundColor: colors.tealMuted,
  },
  addBtnLargeText: {
    color: colors.teal,
    fontSize: 14,
    fontWeight: "700",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheetKAV: { flex: 1 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    maxHeight: "92%",
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    padding: spacing.md + 4,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    ...typography.heading,
    marginBottom: spacing.md,
  },
  field: {
    color: colors.cyan,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  fieldRequired: {
    color: colors.danger,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.md - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    fontSize: 14,
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 1,
  },
  inputMono: { ...typography.mono, fontSize: 13 },
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  iconCell: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  iconCellActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  iconCellLetter: {
    color: colors.cyan,
    fontSize: 14,
    fontWeight: "800",
  },
  iconCellLetterActive: {
    color: colors.textInverse,
  },
  memoWarnBanner: {
    marginTop: 8,
    padding: 10,
    borderRadius: radii.sm,
    backgroundColor: colors.goldMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
  },
  memoWarnText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  pasteBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    backgroundColor: colors.cyanMuted,
    marginTop: 8,
  },
  pasteBarText: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  kindRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  kindChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindChipActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  kindChipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  kindChipTextActive: { color: colors.textInverse },
  sheetActions: { flexDirection: "row" },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: spacing.md,
  },
});
