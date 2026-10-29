// Key Manager — multi-chain key vault.
// Stores secret keys for Stellar, Solana, Bitcoin, Ethereum, and custom chains.
// Watch-only mode: save a public address alone for balance lookup without a key.
// All entries are included in the encrypted backup (.os / .stvault).

import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { copySecretToClipboard } from "@/src/security/clipboard-secret";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
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
  derivePublicAddressForChain,
  entryChain,
  isValidAddressForChain,
  isValidOptionalSeedPhrase,
  isValidPrivateKeyForChain,
  listKeyEntries,
  removeKeyEntry,
  upsertKeyEntry,
  type KeyManagerEntry,
} from "@/src/security/key-manager-store";
import {
  type KeyChain,
  CHAIN_META,
  CHAIN_ORDER,
  fetchChainBalance,
} from "@/src/security/key-chain-utils";
import { checkKmAccess } from "@/src/security/key-manager-access";
import { fetchHorizonBalance } from "@/src/wallet/horizon";
import { SaveOverwriteDeclined } from "@/src/utils/protected-save";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { useSession } from "@/src/state/session";
import {
  canUseKeyManagerWalletSync,
  importKeyManagerEntryAsWallet,
  isKeyManagerEntryInWalletBook,
} from "@/src/wallet/key-manager-wallet-sync";
import { getCurrentTier, hydrateTier } from "@/src/tiers/tier-config";
import { shortenAddress } from "@/src/wallet/stellar";

type EditingState =
  | null
  | {
      id?: string;
      label: string;
      chain: KeyChain;
      watchOnly: boolean;
      secretSeed: string;
      publicAddress: string;
      seedPhrase: string;
      notes: string;
    };

export default function KeyManagerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { refreshWallets } = useSession();

  const [entries, setEntries] = useState<KeyManagerEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [accessChecked, setAccessChecked] = useState(false);

  // Gate check — redirect to the subscribe screen if not allowed.
  useEffect(() => {
    let cancelled = false;
    checkKmAccess().then((result) => {
      if (cancelled) return;
      if (!result.allowed) {
        router.replace("/key-manager-gate");
      } else {
        setAccessChecked(true);
      }
    }).catch(() => {
      if (!cancelled) setAccessChecked(true);
    });
    return () => { cancelled = true; };
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const all = await listKeyEntries();
      setEntries(all);
    } catch (e) {
      console.warn("[KeyManager] refresh failed:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Fetch balance for an expanded entry
  const loadBalance = useCallback(async (entry: KeyManagerEntry) => {
    const chain = entryChain(entry);
    const addr = entry.publicAddress?.trim();
    if (!addr) return;
    const key = entry.id;
    try {
      let raw = "—";
      if (chain === "stellar") {
        const b = await fetchHorizonBalance(addr);
        raw = b ? `${b.total.toFixed(2)} XLM` : "—";
      } else {
        const b = await fetchChainBalance(chain, addr);
        raw = b.raw;
      }
      setBalances((prev) => ({ ...prev, [key]: raw }));
    } catch {
      setBalances((prev) => ({ ...prev, [key]: "—" }));
    }
  }, []);

  useEffect(() => {
    if (!expandedId) return;
    const entry = entries.find((e) => e.id === expandedId);
    if (entry) void loadBalance(entry);
  }, [expandedId, entries, loadBalance]);

  const openNew = () => {
    setEditing({
      label: "",
      chain: "stellar",
      watchOnly: false,
      secretSeed: "",
      publicAddress: "",
      seedPhrase: "",
      notes: "",
    });
  };

  const openEdit = (entry: KeyManagerEntry) => {
    setEditing({
      id: entry.id,
      label: entry.label,
      chain: entryChain(entry),
      watchOnly: entry.watchOnly ?? false,
      secretSeed: entry.secretSeed,
      publicAddress: entry.publicAddress,
      seedPhrase: entry.seedPhrase ?? "",
      notes: entry.notes ?? "",
    });
  };

  const closeSheet = () => setEditing(null);

  const onPrivateKeyChange = (v: string) => {
    setEditing((e) => {
      if (!e) return e;
      const next = { ...e, secretSeed: v };
      if (!e.watchOnly) {
        const derived = derivePublicAddressForChain(e.chain, v);
        if (derived) next.publicAddress = derived;
      }
      return next;
    });
  };

  const onChainChange = (chain: KeyChain) => {
    setEditing((e) => {
      if (!e) return e;
      return { ...e, chain, secretSeed: "", publicAddress: "", seedPhrase: "" };
    });
  };

  const onWatchOnlyToggle = () => {
    setEditing((e) => {
      if (!e) return e;
      const next = !e.watchOnly;
      return { ...e, watchOnly: next, secretSeed: next ? "" : e.secretSeed };
    });
  };

  const handlePaste = async (field: "secretSeed" | "publicAddress" | "seedPhrase") => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) {
        toast.show("Clipboard is empty.", "error");
        return;
      }
      if (field === "secretSeed") {
        onPrivateKeyChange(text);
      } else {
        setEditing((e) => (e ? { ...e, [field]: text } : e));
      }
      toast.show("Pasted from clipboard.", "success");
    } catch {
      toast.show("Couldn't read the clipboard.", "error");
    }
  };

  const copyValue = async (key: string, value: string, label: string) => {
    if (key.endsWith("-seed") || key.endsWith("-phrase")) {
      await copySecretToClipboard(value);
    } else {
      await Clipboard.setStringAsync(value);
    }
    setCopiedKey(key);
    toast.show(`${label} copied`, "success");
    setTimeout(() => {
      setCopiedKey((cur) => (cur === key ? null : cur));
    }, 1600);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const wasNew = !editing.id;
    try {
      const saved = await upsertKeyEntry({
        id: editing.id,
        label: editing.label.trim(),
        chain: editing.chain,
        watchOnly: editing.watchOnly,
        secretSeed: editing.secretSeed.trim(),
        publicAddress: editing.publicAddress.trim(),
        seedPhrase: editing.seedPhrase.trim() || undefined,
        notes: editing.notes.trim() || undefined,
      });
      await refresh();
      await refreshWallets().catch(() => undefined);
      toast.show(editing.id ? "Key updated" : "Key saved", "success");
      closeSheet();

      // Offer wallet-switcher import for Stellar keys (not watch-only)
      if (editing.chain === "stellar" && !editing.watchOnly) {
        if (wasNew) {
          await offerAddToWalletSwitcher(saved);
        } else {
          const inBook = await isKeyManagerEntryInWalletBook(saved.publicAddress);
          if (!inBook) await offerAddToWalletSwitcher(saved);
        }
      }
    } catch (e) {
      if (e instanceof SaveOverwriteDeclined) {
        toast.show(
          e.reason === "empty"
            ? "Save canceled. The key save was not emptied."
            : "Save canceled. The smaller key save was not written.",
          "info",
        );
        return;
      }
      console.warn("[KeyManager] save failed:", e);
      toast.show("Save failed. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const offerAddToWalletSwitcher = async (entry: KeyManagerEntry) => {
    try {
      await hydrateTier().catch(() => undefined);
      const inBook = await isKeyManagerEntryInWalletBook(entry.publicAddress);
      if (inBook) return;

      const plus = canUseKeyManagerWalletSync(getCurrentTier());
      if (!plus) {
        await new Promise<void>((resolve) => {
          Alert.alert(
            "Add to wallet switcher?",
            "Multi-wallet import requires Plus or higher.",
            [{ text: "OK", onPress: () => resolve() }],
          );
        });
        return;
      }

      const shouldAdd = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Add to wallet switcher?",
          `Also add "${entry.label}" (${shortenAddress(entry.publicAddress, 6, 4)}) as a signing wallet?\n\nConfirm to import.`,
          [
            { text: "Skip", style: "cancel", onPress: () => resolve(false) },
            { text: "Add", onPress: () => resolve(true) },
          ],
        );
      });
      if (!shouldAdd) return;

      const { wasAlreadyImported } = await importKeyManagerEntryAsWallet(entry, {
        makeActive: false,
      });
      await refreshWallets().catch(() => undefined);
      toast.show(
        wasAlreadyImported
          ? `"${entry.label}" was already in your wallet switcher.`
          : `"${entry.label}" added to wallet switcher.`,
        "success",
      );
    } catch (e) {
      console.warn("[KeyManager] add to wallet switcher failed:", e);
      toast.show("Couldn't add to wallet switcher.", "error");
    }
  };

  const handleDelete = (entry: KeyManagerEntry) => {
    const emptying = entries.length <= 1;
    Alert.alert(
      emptying ? "Empty key save?" : "Remove key?",
      emptying
        ? `Remove ${entry.label}? Older copies are kept as .bak1–.bak5.`
        : `Remove ${entry.label}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeKeyEntry(entry.id, { confirmShrink: true });
              if (expandedId === entry.id) setExpandedId(null);
              await refresh();
              toast.show("Key removed", "success");
            } catch (e) {
              console.warn("[KeyManager] remove failed:", e);
              toast.show("Remove failed. Please try again.", "error");
            }
          },
        },
      ],
    );
  };

  // Editing validation
  const chain = editing?.chain ?? "stellar";
  const watchOnly = editing?.watchOnly ?? false;
  const meta = CHAIN_META[chain];

  const privateKeyValid = editing
    ? watchOnly || isValidPrivateKeyForChain(chain, editing.secretSeed)
    : false;
  const addrValid = editing
    ? isValidAddressForChain(chain, editing.publicAddress.trim())
    : false;
  const phraseValid = editing
    ? chain === "stellar" || chain === "sol"
      ? isValidOptionalSeedPhrase(editing.seedPhrase)
      : true
    : true;
  const canSave =
    !!editing &&
    editing.label.trim().length > 0 &&
    (watchOnly || privateKeyValid) &&
    addrValid &&
    phraseValid;

  // Gate result arrives after the first paint. Every hook above must
  // run on that first paint too — returning earlier crashes Key Manager
  // with "Rendered more hooks than during the previous render."
  if (!accessChecked) {
    return (
      <SafeAreaView style={styles.root} testID="key-manager-loading">
        <Stack.Screen options={{ title: "Key Manager", headerShown: false }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ title: "Key Manager", headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          testID="key-manager-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Key Manager</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => router.push("/key-manager-pair")}
            style={styles.headerBtn}
            testID="key-manager-pair"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Pair with Fortress Key Manager"
          >
            <Feather name="link" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openNew}
            style={styles.headerBtn}
            testID="key-manager-new"
          >
            <Feather name="plus" size={22} color={colors.cyan} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Secret keys and watch-only addresses for any chain. Included in your
          encrypted backup.
        </Text>

        {entries.length === 0 ? (
          <View style={styles.emptyCard} testID="key-manager-empty">
            <Feather name="key" size={26} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No saved keys</Text>
            <Text style={styles.emptyBody}>
              Tap + to add a key or watch-only address for Stellar, SOL, BTC, ETH, or any other chain.
            </Text>
          </View>
        ) : (
          entries.map((entry) => {
            const expanded = expandedId === entry.id;
            const eChain = entryChain(entry);
            const chainMeta = CHAIN_META[eChain];
            const balance = balances[entry.id];
            return (
              <Pressable
                key={entry.id}
                onPress={() =>
                  setExpandedId((cur) => (cur === entry.id ? null : entry.id))
                }
                onLongPress={() => handleDelete(entry)}
                style={[
                  styles.entryCard,
                  expanded ? styles.entryCardExpanded : null,
                ]}
                testID={`key-card-${entry.id}`}
              >
                <View style={styles.avatar}>
                  <Feather name="key" size={14} color={colors.cyan} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.entryTopRow}>
                    <Text style={styles.entryLabel} numberOfLines={1}>
                      {entry.label || "Unnamed"}
                    </Text>
                    <View style={styles.chainBadge}>
                      <Text style={styles.chainBadgeText}>{eChain.toUpperCase()}</Text>
                    </View>
                    {entry.watchOnly ? (
                      <View style={[styles.chainBadge, styles.watchBadge]}>
                        <Feather name="eye" size={9} color={colors.teal} />
                        <Text style={styles.watchBadgeText}>WATCH</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.entryAddr} numberOfLines={1}>
                    {shortenAddress(entry.publicAddress, 6, 6)}
                  </Text>
                  {balance ? (
                    <Text style={styles.entryBalance} numberOfLines={1}>
                      {balance}
                    </Text>
                  ) : null}

                  {expanded ? (
                    <View style={styles.detailBlock}>
                      <Text style={styles.chainLine}>{chainMeta.label}</Text>
                      <DetailRow
                        label="Public Address"
                        value={entry.publicAddress}
                        copied={copiedKey === `${entry.id}-addr`}
                        onCopy={() =>
                          copyValue(`${entry.id}-addr`, entry.publicAddress, "Public address")
                        }
                      />
                      {!entry.watchOnly && entry.secretSeed ? (
                        <DetailRow
                          label={chainMeta.keyLabel}
                          value={entry.secretSeed}
                          copied={copiedKey === `${entry.id}-seed`}
                          onCopy={() =>
                            copyValue(`${entry.id}-seed`, entry.secretSeed, "Private key")
                          }
                          sensitive
                        />
                      ) : null}
                      {entry.seedPhrase ? (
                        <DetailRow
                          label="Seed Phrase"
                          value={entry.seedPhrase}
                          copied={copiedKey === `${entry.id}-phrase`}
                          onCopy={() =>
                            copyValue(`${entry.id}-phrase`, entry.seedPhrase!, "Seed phrase")
                          }
                          sensitive
                        />
                      ) : null}
                      {entry.notes ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailKey}>NOTES</Text>
                          <Text style={styles.detailVal}>{entry.notes}</Text>
                        </View>
                      ) : null}
                      {balance ? (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailKey}>BALANCE</Text>
                          <Text style={[styles.detailVal, { color: colors.cyan }]}>{balance}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <View style={styles.entryActions}>
                  <TouchableOpacity
                    onPress={() => openEdit(entry)}
                    style={styles.iconBtn}
                    testID={`key-edit-${entry.id}`}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Feather name="edit-2" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(entry)}
                    style={styles.iconBtn}
                    testID={`key-delete-${entry.id}`}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Feather name="trash-2" size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <Feather
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.textTertiary}
                  />
                </View>
              </Pressable>
            );
          })
        )}

        <TouchableOpacity
          onPress={openNew}
          style={styles.addBtnLarge}
          testID="key-manager-add-bottom"
          activeOpacity={0.85}
        >
          <Feather name="plus" size={16} color={colors.cyan} />
          <Text style={styles.addBtnLargeText}>Add Key</Text>
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
          <ScrollView
            style={[styles.sheet, { paddingTop: insets.top + spacing.md }]}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
            testID="key-editor-sheet"
          >
            <Text style={styles.sheetTitle}>
              {editing?.id ? "Edit key" : "Add key"}
            </Text>

            {/* Chain selector */}
            <Text style={styles.field}>CHAIN</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chainRow}
            >
              {CHAIN_ORDER.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => onChainChange(c)}
                  style={[styles.chainChip, chain === c && styles.chainChipOn]}
                  testID={`key-chain-${c}`}
                >
                  <Text style={[styles.chainChipText, chain === c && styles.chainChipTextOn]}>
                    {CHAIN_META[c].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Watch-only toggle */}
            <TouchableOpacity
              onPress={onWatchOnlyToggle}
              style={styles.watchToggle}
              testID="key-watch-only-toggle"
            >
              <View style={[styles.watchToggleCheck, watchOnly && styles.watchToggleCheckOn]}>
                {watchOnly ? <Feather name="check" size={11} color={colors.background} /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.watchToggleLabel}>Watch-only (no private key)</Text>
                <Text style={styles.watchToggleSub}>
                  Save a public address for balance lookup only — no seed stored
                </Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.field}>LABEL</Text>
            <TextInput
              value={editing?.label ?? ""}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, label: v } : e))}
              placeholder="e.g. Cold storage, Hot wallet, Exchange"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              maxLength={48}
              autoFocus
              testID="key-input-label"
            />

            {!watchOnly ? (
              <>
                <Text style={styles.field}>{meta.keyLabel.toUpperCase()} (REQUIRED)</Text>
                <TextInput
                  value={editing?.secretSeed ?? ""}
                  onChangeText={onPrivateKeyChange}
                  placeholder={meta.keyPlaceholder}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize={chain === "stellar" ? "characters" : "none"}
                  autoCorrect={false}
                  style={[
                    styles.input,
                    styles.inputMono,
                    editing &&
                      editing.secretSeed.trim().length > 0 &&
                      !privateKeyValid &&
                      styles.inputError,
                  ]}
                  testID="key-input-seed"
                />
                <TouchableOpacity
                  onPress={() => handlePaste("secretSeed")}
                  style={styles.pasteBar}
                  testID="key-paste-seed"
                  activeOpacity={0.85}
                >
                  <Feather name="clipboard" size={14} color={colors.cyan} />
                  <Text style={styles.pasteBarText}>Paste private key</Text>
                </TouchableOpacity>
              </>
            ) : null}

            <Text style={styles.field}>{meta.addressLabel.toUpperCase()}</Text>
            <TextInput
              value={editing?.publicAddress ?? ""}
              onChangeText={(v) =>
                setEditing((e) => (e ? { ...e, publicAddress: v } : e))
              }
              placeholder={meta.addressPlaceholder}
              placeholderTextColor={colors.textTertiary}
              autoCapitalize={chain === "stellar" ? "characters" : "none"}
              autoCorrect={false}
              style={[
                styles.input,
                styles.inputMono,
                editing &&
                  editing.publicAddress.trim().length > 0 &&
                  !addrValid &&
                  styles.inputError,
              ]}
              testID="key-input-address"
            />
            <TouchableOpacity
              onPress={() => handlePaste("publicAddress")}
              style={styles.pasteBar}
              testID="key-paste-address"
              activeOpacity={0.85}
            >
              <Feather name="clipboard" size={14} color={colors.cyan} />
              <Text style={styles.pasteBarText}>Paste address</Text>
            </TouchableOpacity>

            {(chain === "stellar" || chain === "sol") && !watchOnly ? (
              <>
                <Text style={styles.field}>SEED PHRASE (OPTIONAL)</Text>
                <TextInput
                  value={editing?.seedPhrase ?? ""}
                  onChangeText={(v) =>
                    setEditing((e) => (e ? { ...e, seedPhrase: v } : e))
                  }
                  placeholder="12 or 24 words"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline
                  style={[
                    styles.input,
                    styles.inputMultiline,
                    editing &&
                      editing.seedPhrase.trim().length > 0 &&
                      !phraseValid &&
                      styles.inputError,
                  ]}
                  testID="key-input-phrase"
                />
                <TouchableOpacity
                  onPress={() => handlePaste("seedPhrase")}
                  style={styles.pasteBar}
                  testID="key-paste-phrase"
                  activeOpacity={0.85}
                >
                  <Feather name="clipboard" size={14} color={colors.cyan} />
                  <Text style={styles.pasteBarText}>Paste seed phrase</Text>
                </TouchableOpacity>
              </>
            ) : null}

            <Text style={styles.field}>NOTES (OPTIONAL)</Text>
            <TextInput
              value={editing?.notes ?? ""}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, notes: v } : e))}
              placeholder="Optional notes"
              placeholderTextColor={colors.textTertiary}
              multiline
              style={[styles.input, styles.inputMultiline]}
              maxLength={280}
              testID="key-input-notes"
            />

            <View style={{ height: spacing.md }} />
            <View style={styles.sheetActions}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={closeSheet}
                style={{ flex: 1 }}
                testID="key-cancel"
              />
              <View style={{ width: spacing.sm }} />
              <Button
                label={busy ? "Saving…" : "Save"}
                icon="check"
                onPress={save}
                disabled={!canSave}
                loading={busy}
                style={{ flex: 1 }}
                testID="key-save"
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  copied,
  onCopy,
  sensitive,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  sensitive?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailKey}>{label.toUpperCase()}</Text>
        <TouchableOpacity
          onPress={onCopy}
          style={styles.copyBtn}
          hitSlop={8}
          accessibilityLabel={`Copy ${label}`}
        >
          <Feather name={copied ? "check" : "copy"} size={12} color={colors.cyan} />
          <Text style={styles.copyBtnText}>{copied ? "Copied" : "Copy"}</Text>
        </TouchableOpacity>
      </View>
      <Text
        style={[styles.detailVal, sensitive ? styles.detailValSensitive : null]}
        selectable
      >
        {value}
      </Text>
    </View>
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
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  intro: {
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
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    gap: 8,
    ...tileShadow(),
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
    alignItems: "flex-start",
    gap: 10,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  entryCardExpanded: {
    borderColor: colors.borderGlow,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radii.md,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  entryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  entryLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  chainBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
  },
  chainBadgeText: {
    color: colors.cyan,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  watchBadge: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.teal,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  watchBadgeText: {
    color: colors.teal,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  entryAddr: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
    ...typography.mono,
  },
  entryBalance: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  detailBlock: {
    marginTop: spacing.sm,
    gap: 8,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  chainLine: {
    color: colors.textTertiary,
    fontSize: 11,
    fontStyle: "italic",
  },
  detailRow: { gap: 2 },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailKey: {
    color: colors.textTertiary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  detailVal: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    ...typography.mono,
  },
  detailValSensitive: {
    color: colors.cyan,
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  copyBtnText: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "700",
  },
  entryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingTop: 2,
  },
  iconBtn: { padding: 6, borderRadius: 8 },
  addBtnLarge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.sm,
    paddingVertical: spacing.md - 4,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    borderStyle: "dashed",
    backgroundColor: colors.cyanMuted,
  },
  addBtnLargeText: {
    color: colors.cyan,
    fontSize: 13,
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
    maxHeight: "94%",
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: spacing.md + 4,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    ...typography.heading,
    marginBottom: spacing.sm,
  },
  field: {
    color: colors.cyan,
    fontSize: 10,
    ...typography.label,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  chainRow: {
    flexDirection: "row",
    gap: 6,
    paddingBottom: 4,
  },
  chainChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
  },
  chainChipOn: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  chainChipText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  chainChipTextOn: {
    color: colors.cyan,
  },
  watchToggle: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: spacing.sm,
    marginBottom: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  watchToggleCheck: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderGlow,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  watchToggleCheckOn: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  watchToggleLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  watchToggleSub: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    fontSize: 13,
  },
  inputError: {
    borderColor: colors.danger,
    borderWidth: 1,
  },
  inputMono: { ...typography.mono, fontSize: 12 },
  inputMultiline: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  pasteBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    backgroundColor: colors.cyanMuted,
    marginTop: 6,
  },
  pasteBarText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  sheetActions: { flexDirection: "row" },
});
