// @CONTEXT: Context-aware History screen. Opened from any tab's clock icon
// with `?source=wallet|vaults|notebook|calendar`; header title, subtitle,
// and data source all switch on `source`. The delete affordance is
// INTENTIONALLY enabled ONLY for notebook and calendar sources — transaction
// and vault-history rows must never be deletable (they represent immutable
// on-chain events plus the archived-overlay records that back them).

import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, Transaction, Vault } from "@/src/api/client";
import { describeError } from "@/src/api/describe-error";
import { useToast } from "@/src/components/Toast";
import { useSession } from "@/src/state/session";
import { useTabReturn } from "@/src/navigation/useTabReturn";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { formatTimestamp, formatUnlockDate } from "@/src/vault/countdown";
import { localeForCurrency } from "@/src/utils/date-locale";
import { fetchWalletPayments, type WalletPayment } from "@/src/wallet/horizon";
import { shortenAddress } from "@/src/wallet/stellar";
import {
  listBetaVaults,
  tokenSymbolForAddress,
  listTtlRenewals,
  stroopsToXlmString,
  type BetaVaultRecord,
  type TtlRenewalLogEntry,
} from "@/src/wallet/multi-asset-beta";
import {
  ADVANCED_VAULT_KIND_META,
  listAdvancedVaults,
  stroopsToFloat,
  type AdvancedVaultKind,
  type AdvancedVaultRecord,
} from "@/src/wallet/advanced-vaults";

type SourceKind = "wallet" | "vaults";

type VaultCategory = "regular" | "advanced" | "multi-asset";

type LifecycleMode = "active" | "archived";

type WalletFilter = "all" | "send" | "receive" | "swap";

const WALLET_FILTER_META: Record<
  WalletFilter,
  { label: string; icon: keyof typeof Feather.glyphMap }
> = {
  all: { label: "All", icon: "list" },
  send: { label: "Send", icon: "arrow-up-right" },
  receive: { label: "Receive", icon: "arrow-down-left" },
  swap: { label: "Swaps", icon: "refresh-cw" },
};

const VAULT_CATEGORY_TABS: {
  id: VaultCategory;
  label: string;
}[] = [
  { id: "regular", label: "Vaults" },
  { id: "advanced", label: "Advanced Vaults" },
  { id: "multi-asset", label: "Multi-Asset" },
];

const TITLES: Record<SourceKind, { title: string; sub: string }> = {
  wallet: {
    title: "Transaction History",
    sub: "Every send, receive and swap from this wallet.",
  },
  vaults: {
    title: "Vault History",
    sub: "Active and archived vaults by type.",
  },
};

const META: Record<
  Transaction["kind"],
  { icon: keyof typeof Feather.glyphMap; label: string; color: string }
> = {
  create: { icon: "plus-square", label: "Vault Created", color: colors.teal },
  deposit: { icon: "arrow-down-left", label: "Deposit", color: colors.cyan },
  extend: { icon: "fast-forward", label: "Lock Extended", color: colors.gold },
  withdraw: { icon: "arrow-up-right", label: "Withdrawal", color: colors.text },
};

// @CONTEXT: Unified wallet-history feed discriminator. `payment` = Horizon
// XLM sends/receives; `vault` = vault-lifecycle Transactions; `ttl_renewal`
// = TTL keep-alive events which never appear in Horizon (no asset moves)
// nor the backend Transaction feed — the local renewal log is their only
// record anywhere in the app.
type WalletFeedItem =
  | { source: "vault"; tx: Transaction }
  | { source: "payment"; tx: WalletPayment }
  | { source: "ttl_renewal"; tx: TtlRenewalLogEntry };

const PAYMENT_META: Record<
  WalletPayment["kind"],
  { icon: keyof typeof Feather.glyphMap; label: string; color: string }
> = {
  send: { icon: "arrow-up-right", label: "Send", color: colors.text },
  receive: { icon: "arrow-down-left", label: "Receive", color: colors.cyan },
};

export default function History() {
  useTabReturn();
  const params = useLocalSearchParams<{ source?: string }>();
  const router = useRouter();
  // @CONTEXT: `source` is LOCAL STATE so the wallet⇄vaults segmented
  // control can flip views without a route change (which would re-mount
  // the screen and reset scroll position). Initial value still comes from
  // the URL param, so deep links / router.push({params}) keep working.
  // Vault history is the default landing (Regular + Active).
  const initialSource: SourceKind = useMemo(() => {
    const s = (params.source ?? "").toString().toLowerCase();
    if (s === "wallet") return "wallet";
    return "vaults";
  }, [params.source]);
  const [source, setSource] = useState<SourceKind>(initialSource);
  const [vaultCategory, setVaultCategory] = useState<VaultCategory>("regular");
  // Each history sub-tab keeps its own Active | Archived preference (default Active).
  const [lifecycleByCategory, setLifecycleByCategory] = useState<
    Record<VaultCategory, LifecycleMode>
  >({
    regular: "active",
    advanced: "active",
    "multi-asset": "active",
  });
  const lifecycleMode = lifecycleByCategory[vaultCategory];
  useEffect(() => {
    setSource(initialSource);
  }, [initialSource]);

  // @CONTEXT: History screen lives OUTSIDE the (tabs) group, so it sits on
  // the root Stack navigator. Both the phone's back gesture and the on-
  // screen back button pop this screen and reveal whichever tab was
  // underneath — `router.back()` is correct for both.

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="history-screen">
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBackBtn}
            testID="history-back-button"
            accessibilityLabel="Back"
            hitSlop={10}
          >
            <Feather name="chevron-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} testID={`history-title-${source}`}>
              {TITLES[source].title}
            </Text>
            <Text style={styles.sub}>{TITLES[source].sub}</Text>
          </View>
        </View>
        {/* Wallet ⇄ Vaults toggle — wallet keeps send/receive/swap feed;
            vaults is the primary history surface with category tabs. */}
        <View style={styles.segRow} testID="history-source-toggle">
          {(
            [
              { id: "wallet" as const, label: "Wallet", icon: "credit-card" as const },
              { id: "vaults" as const, label: "Vaults", icon: "lock" as const },
            ]
          ).map((seg) => {
            const active = source === seg.id;
            return (
              <TouchableOpacity
                key={seg.id}
                onPress={() => setSource(seg.id)}
                style={[styles.segBtn, active && styles.segBtnActive]}
                testID={`history-toggle-${seg.id}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Feather
                  name={seg.icon}
                  size={13}
                  color={active ? colors.textInverse : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.segText,
                    active && styles.segTextActive,
                  ]}
                >
                  {seg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {source === "vaults" ? (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
              testID="history-vault-category-tabs"
            >
              {VAULT_CATEGORY_TABS.map((tab) => {
                const active = vaultCategory === tab.id;
                return (
                  <TouchableOpacity
                    key={tab.id}
                    onPress={() => setVaultCategory(tab.id)}
                    style={[styles.categoryBtn, active && styles.categoryBtnActive]}
                    testID={`history-category-${tab.id}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        active && styles.categoryTextActive,
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.lifecycleRow} testID="history-lifecycle-toggle">
              {(
                [
                  { id: "active" as const, label: "Active" },
                  { id: "archived" as const, label: "Archived" },
                ]
              ).map((seg) => {
                const active = lifecycleMode === seg.id;
                return (
                  <TouchableOpacity
                    key={seg.id}
                    onPress={() =>
                      setLifecycleByCategory((prev) => ({
                        ...prev,
                        [vaultCategory]: seg.id,
                      }))
                    }
                    style={[styles.lifecycleBtn, active && styles.lifecycleBtnActive]}
                    testID={`history-lifecycle-${seg.id}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      style={[
                        styles.lifecycleText,
                        active && styles.lifecycleTextActive,
                      ]}
                    >
                      {seg.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}
      </View>
      <VaultTransactionList
        source={source}
        vaultCategory={vaultCategory}
        lifecycleMode={lifecycleMode}
      />
    </SafeAreaView>
  );
}

function VaultTransactionList({
  source,
  vaultCategory,
  lifecycleMode,
}: {
  source: SourceKind;
  vaultCategory: VaultCategory;
  lifecycleMode: LifecycleMode;
}) {
  const { wallet, formatXlm } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Transaction[]>([]);
  // Vault metadata (name + status) needed to render a single consolidated
  // collapsible per vault under the "vaults" source.
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [betaVaults, setBetaVaults] = useState<BetaVaultRecord[]>([]);
  const [advancedVaults, setAdvancedVaults] = useState<AdvancedVaultRecord[]>([]);
  // Horizon-side XLM payment history — only fetched for the wallet source.
  const [payments, setPayments] = useState<WalletPayment[]>([]);
  // Local TTL-renewal log, merged into the "wallet" feed.
  const [renewals, setRenewals] = useState<TtlRenewalLogEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // @CONTEXT: Distinguish first-load spinner from pull-to-refresh — users
  // complained the list flashed "empty" for a beat before rows appeared,
  // mistaking the blank as stale/broken data.
  const [firstLoading, setFirstLoading] = useState(true);
  const [expandedVaults, setExpandedVaults] = useState<Set<string>>(new Set());
  // Wallet-source filter — `all` shows the unified feed; the others narrow
  // the render list without re-fetching.
  const [walletFilter, setWalletFilter] = useState<WalletFilter>("all");
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (!wallet) {
      // @CONTEXT: Must clear firstLoading here so the source==="wallet"
      // render pass falls through to the "Connect a wallet" empty-state.
      // Without this, the page would sit on the loading indicator forever.
      setFirstLoading(false);
      return;
    }
    try {
      const [list, pays, renewalLog, vlist, betaList, advList] = await Promise.all([
        api.allTransactions(wallet.publicKey),
        source === "wallet"
          ? fetchWalletPayments(wallet.publicKey, 50).catch(() => [])
          : Promise.resolve([] as WalletPayment[]),
        source === "wallet"
          ? listTtlRenewals(wallet.publicKey).catch(() => [] as TtlRenewalLogEntry[])
          : Promise.resolve([] as TtlRenewalLogEntry[]),
        source === "vaults"
          ? // @CONTEXT: publicKey passed as beneficiary too so vaults where
            // this wallet is the Dead Man's Switch backup_address are visible
            // in the vault-history view alongside owner-owned vaults. The
            // soroban client always runs the owner pipeline first and merges
            // beneficiary rows additively, so this cannot regress own-vault
            // history rendering.
            api
              .listVaults(wallet.publicKey, wallet.publicKey)
              .catch(() => [] as Vault[])
          : Promise.resolve([] as Vault[]),
        source === "vaults"
          ? listBetaVaults(wallet.publicKey).catch(() => [] as BetaVaultRecord[])
          : Promise.resolve([] as BetaVaultRecord[]),
        source === "vaults"
          ? listAdvancedVaults(wallet.publicKey, wallet.publicKey).catch(
              () => [] as AdvancedVaultRecord[],
            )
          : Promise.resolve([] as AdvancedVaultRecord[]),
      ]);
      setItems(list);
      setPayments(pays);
      setRenewals(renewalLog);
      setVaults(vlist);
      setBetaVaults(betaList);
      setAdvancedVaults(advList);
    } catch (e) {
      const f = describeError(e);
      toast.show(
        f.message,
        "error",
        f.retryable
          ? { action: { label: "Retry", onPress: () => load() } }
          : undefined,
      );
    } finally {
      setFirstLoading(false);
    }
  }, [wallet, toast, source]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // @CONTEXT: Wallet-source unified feed renders Horizon payments + TTL
  // renewal log ONLY — vault-lifecycle transactions belong in the
  // dedicated Vault History view (source = "vaults"). Surfacing them here
  // made wallet history noisier and duplicated the vault feed.
  const walletFeed = useMemo<WalletFeedItem[]>(() => {
    if (source !== "wallet") return [];
    const feed: WalletFeedItem[] = [];
    for (const p of payments) feed.push({ source: "payment", tx: p });
    for (const r of renewals) feed.push({ source: "ttl_renewal", tx: r });
    feed.sort((a, b) => {
      const ta =
        a.source === "vault"
          ? a.tx.timestamp
          : a.source === "ttl_renewal"
            ? Math.floor(a.tx.timestampMs / 1000)
            : a.tx.timestamp;
      const tb =
        b.source === "vault"
          ? b.tx.timestamp
          : b.source === "ttl_renewal"
            ? Math.floor(b.tx.timestampMs / 1000)
            : b.tx.timestamp;
      return tb - ta;
    });
    return feed;
  }, [source, payments, renewals]);

  // @CONTEXT: Classify each feed item for filter-chip narrowing. Swaps are
  // detected via memo shape (text memo of pure digits — SimpleSwap's
  // signature). TTL renewals classify to "renewal" and never match
  // send/receive/swap chips, so they only surface in the unfiltered
  // "All" view (which bypasses classification below).
  const classifyWalletItem = useCallback(
    (item: WalletFeedItem): WalletFilter | "renewal" => {
      if (item.source === "ttl_renewal") return "renewal";
      if (item.source === "vault") return "send"; // dead branch — vault items no longer flow into wallet feed
      const p = item.tx;
      const isSwapMemo =
        p.memo_type &&
        p.memo_type.toLowerCase().includes("text") &&
        /^\d+$/.test(p.memo.trim());
      if (isSwapMemo) return "swap";
      return p.kind === "send" ? "send" : "receive";
    },
    [],
  );

  const walletFeedFiltered = useMemo<WalletFeedItem[]>(() => {
    if (walletFilter === "all") return walletFeed;
    return walletFeed.filter((it) => classifyWalletItem(it) === walletFilter);
  }, [walletFeed, walletFilter, classifyWalletItem]);

  const walletFilterCounts = useMemo(() => {
    const counts: Record<WalletFilter, number> = {
      all: walletFeed.length,
      send: 0,
      receive: 0,
      swap: 0,
    };
    for (const it of walletFeed) {
      const k = classifyWalletItem(it);
      if (k === "renewal") continue; // no dedicated filter chip for these
      counts[k] += 1;
    }
    return counts;
  }, [walletFeed, classifyWalletItem]);

  // @CONTEXT: Group transactions by vault_id for the "vaults" source. We
  // UNION the vault metadata list with the transaction stream so archived
  // vaults with zero recent txs still appear as first-class groups.
  const vaultGroups = useMemo(() => {
    if (source !== "vaults") return null;
    const groups = new Map<
      string,
      { txs: Transaction[]; vault: Vault | null }
    >();
    for (const v of vaults) {
      groups.set(v.vault_id, { txs: [], vault: v });
    }
    for (const t of items) {
      const g = groups.get(t.vault_id) ?? {
        txs: [] as Transaction[],
        vault: null,
      };
      g.txs.push(t);
      groups.set(t.vault_id, g);
    }
    for (const [, g] of groups) {
      g.txs.sort((a, b) => b.timestamp - a.timestamp);
    }
    return Array.from(groups.entries()).sort(([, a], [, b]) => {
      // Sort by newest activity; fall back to vault creation timestamp.
      const ta = a.txs[0]?.timestamp ?? a.vault?.created_at ?? 0;
      const tb = b.txs[0]?.timestamp ?? b.vault?.created_at ?? 0;
      return tb - ta;
    });
  }, [items, source, vaults]);

  const toggleVault = useCallback((vaultId: string) => {
    setExpandedVaults((prev) => {
      const next = new Set(prev);
      if (next.has(vaultId)) next.delete(vaultId);
      else next.add(vaultId);
      return next;
    });
  }, []);

  if (firstLoading) {
    return (
      <View style={styles.loadingWrap} testID="history-loading">
        <ActivityIndicator size="small" color={colors.cyan} />
        <Text style={styles.loadingText}>Loading activity…</Text>
      </View>
    );
  }

  // `load()` used to bail without clearing firstLoading, causing infinite spinner.
  if (source === "wallet" && !wallet) {
    return (
      <View style={styles.walletEmpty} testID="wallet-history-no-wallet">
        <View style={styles.walletEmptyIconWrap}>
          <Feather name="link" size={26} color={colors.cyan} />
        </View>
        <Text style={styles.walletEmptyTitle}>Connect a wallet to view history</Text>
        <Text style={styles.walletEmptyBody}>
          Restore an existing Stellar seed or create a fresh burner to see
          your Send / Receive / Vault / Swap history in one unified feed.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace("/")}
          style={styles.walletEmptyBtn}
          testID="wallet-history-connect-btn"
          activeOpacity={0.85}
        >
          <Feather name="key" size={15} color={colors.textInverse} />
          <Text style={styles.walletEmptyBtnText}>Connect a wallet</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (source === "vaults") {
    const groups = vaultGroups ?? [];
    const nowSec = Math.floor(Date.now() / 1000);

    const isRegularArchived = (g: { vault: Vault | null }) =>
      g.vault?.status === "withdrawn" || g.vault?.status === "archived";
    const isBetaArchived = (r: BetaVaultRecord) => r.withdrawn;
    const isAdvancedArchived = (v: AdvancedVaultRecord) =>
      v.withdrawn || v.claimedByBackup;

    // Advanced tab = Cooling-Off and Vesting Schedule only.
    const regularEntries = groups.filter(([, g]) =>
      lifecycleMode === "archived" ? isRegularArchived(g) : !isRegularArchived(g),
    );
    const betaEntries = betaVaults.filter((r) =>
      lifecycleMode === "archived" ? isBetaArchived(r) : !isBetaArchived(r),
    );
    const advancedEntries = advancedVaults.filter((v) => {
      if (v.kind !== "CoolingOff" && v.kind !== "Vesting") return false;
      return lifecycleMode === "archived"
        ? isAdvancedArchived(v)
        : !isAdvancedArchived(v);
    });

    const renderVaultGroup = (
      entry: [string, { txs: Transaction[]; vault: Vault | null }],
    ) => {
      const [vaultId, group] = entry;
      const { txs, vault } = group;
      const expanded = expandedVaults.has(vaultId);
      const shortId = vaultId.slice(0, 8);
      const latest = txs[0];
      const displayName =
        vault?.name && vault.name.trim().length > 0
          ? vault.name
          : `Vault ${shortId}…`;
      return (
        <View
          key={vaultId}
          style={styles.vaultGroup}
          testID={`history-vault-group-${shortId}`}
        >
          <TouchableOpacity
            onPress={() => toggleVault(vaultId)}
            style={styles.vaultGroupHeader}
            activeOpacity={0.7}
            testID={`history-vault-toggle-${shortId}`}
          >
            <Feather
              name={expanded ? "chevron-down" : "chevron-right"}
              size={16}
              color={colors.cyan}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.vaultGroupTitleRow}>
                <Text style={styles.vaultGroupName} numberOfLines={1}>
                  {displayName}
                </Text>
                <View style={styles.historyTypeBadge}>
                  <Text style={[styles.historyTypeBadgeText, { color: colors.teal }]}>
                    Regular
                  </Text>
                </View>
              </View>
              <Text style={styles.vaultGroupSub}>
                {txs.length} {txs.length === 1 ? "event" : "events"}
                {latest ? ` · latest ${formatTimestamp(latest.timestamp)}` : ""}
              </Text>
            </View>
          </TouchableOpacity>
          {expanded ? (
            <View style={styles.vaultGroupBody}>
              {txs.length === 0 ? (
                <Text style={styles.note}>No ledger events recorded.</Text>
              ) : (
                txs.map((item) => {
                  const meta = META[item.kind];
                  return (
                    <View
                      key={item.tx_id}
                      style={styles.row}
                      testID={`tx-row-${item.tx_id}`}
                    >
                      <View
                        style={[
                          styles.iconWrap,
                          { backgroundColor: hex(meta.color, 0.15) },
                        ]}
                      >
                        <Feather name={meta.icon} size={16} color={meta.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kind}>{meta.label}</Text>
                        {item.note ? (
                          <Text style={styles.note}>{item.note}</Text>
                        ) : null}
                        <Text style={styles.time}>
                          {formatTimestamp(item.timestamp)}
                        </Text>
                      </View>
                      {item.amount > 0 ? (
                        <Text
                          style={[
                            styles.amount,
                            {
                              color:
                                item.kind === "withdraw"
                                  ? colors.text
                                  : colors.teal,
                            },
                          ]}
                        >
                          {item.kind === "withdraw" ? "-" : "+"}
                          {formatXlm(item.amount)}
                        </Text>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>
          ) : null}
        </View>
      );
    };

    const renderBetaRow = (r: BetaVaultRecord) => {
      const symbol = tokenSymbolForAddress(r.tokenContractId) ?? "TOKEN";
      const amountFloat = Number(r.balance) / 10_000_000;
      const status = r.withdrawn
        ? "withdrawn"
        : r.unlockTimestamp <= nowSec
          ? "unlocked"
          : "locked";
      const icon =
        status === "locked" ? "lock" : status === "unlocked" ? "unlock" : "check";
      const color =
        status === "locked"
          ? colors.teal
          : status === "unlocked"
            ? colors.gold
            : colors.textTertiary;
      return (
        <TouchableOpacity
          key={`beta-${r.vaultId.toString()}`}
          style={styles.row}
          testID={`history-beta-vault-${r.vaultId.toString()}`}
          onPress={() =>
            router.push({
              pathname: "/vault/[id]",
              params: { id: r.vaultId.toString(), type: "multi-asset" },
            })
          }
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: hex(color, 0.15) }]}>
            <Feather name={icon} size={16} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.vaultGroupTitleRow}>
              <Text style={styles.kind} numberOfLines={1}>
                {r.name || `Vault #${r.vaultId.toString()}`}
              </Text>
              <View style={[styles.historyTypeBadge, { borderColor: colors.gold }]}>
                <Text style={[styles.historyTypeBadgeText, { color: colors.gold }]}>
                  Multi-Asset
                </Text>
              </View>
            </View>
            <Text style={styles.note}>
              {status === "withdrawn"
                ? `Withdrawn · ${formatUnlockDate(r.unlockTimestamp)}`
                : status === "unlocked"
                  ? `Ready to withdraw · ${formatUnlockDate(r.unlockTimestamp)}`
                  : `Unlocks ${formatUnlockDate(r.unlockTimestamp)}`}
            </Text>
          </View>
          <Text
            style={[
              styles.amount,
              { color: status === "withdrawn" ? colors.text : colors.teal },
            ]}
          >
            {amountFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
            {symbol}
          </Text>
        </TouchableOpacity>
      );
    };

    const renderAdvancedRow = (v: AdvancedVaultRecord) => {
      const amountFloat = stroopsToFloat(v.balance);
      const status =
        v.withdrawn || v.claimedByBackup
          ? "withdrawn"
          : v.unlockTimestamp > 0 && v.unlockTimestamp <= nowSec
            ? "unlocked"
            : "locked";
      const icon =
        status === "locked" ? "lock" : status === "unlocked" ? "unlock" : "check";
      const color =
        status === "locked"
          ? colors.teal
          : status === "unlocked"
            ? colors.gold
            : colors.textTertiary;
      const kindLabel =
        v.kind === "TimeLock"
          ? "Time Lock"
          : ADVANCED_VAULT_KIND_META[
              v.kind as Exclude<AdvancedVaultKind, "TimeLock">
            ]?.label ?? v.kind;
      const accent =
        v.kind === "CoolingOff"
          ? ADVANCED_VAULT_KIND_META.CoolingOff.accent
          : v.kind === "Vesting"
            ? ADVANCED_VAULT_KIND_META.Vesting.accent
            : v.kind === "HTLC"
              ? ADVANCED_VAULT_KIND_META.HTLC.accent
              : colors.cyan;
      return (
        <TouchableOpacity
          key={`adv-${v.kind}-${v.vaultId.toString()}`}
          style={styles.row}
          testID={`history-advanced-vault-${v.vaultId.toString()}`}
          onPress={() =>
            v.kind === "HTLC"
              ? router.push(`/htlc/${v.vaultId.toString()}` as never)
              : router.push({
                  pathname: "/vault/[id]",
                  params: { id: v.vaultId.toString(), type: "advanced" },
                })
          }
          activeOpacity={0.75}
        >
          <View style={[styles.iconWrap, { backgroundColor: hex(color, 0.15) }]}>
            <Feather name={icon} size={16} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.vaultGroupTitleRow}>
              <Text style={styles.kind} numberOfLines={1}>
                {v.name || `Vault #${v.vaultId.toString()}`}
              </Text>
              <View style={[styles.historyTypeBadge, { borderColor: accent }]}>
                <Text style={[styles.historyTypeBadgeText, { color: accent }]}>
                  {kindLabel}
                </Text>
              </View>
            </View>
            <Text style={styles.note}>
              {kindLabel}
              {status === "withdrawn"
                ? " · Withdrawn"
                : v.unlockTimestamp > 0
                  ? ` · ${formatUnlockDate(v.unlockTimestamp)}`
                  : ""}
            </Text>
          </View>
          <Text
            style={[
              styles.amount,
              { color: status === "withdrawn" ? colors.text : colors.teal },
            ]}
          >
            {amountFloat.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
            XLM
          </Text>
        </TouchableOpacity>
      );
    };

    const emptyCopy =
      vaultCategory === "regular"
        ? lifecycleMode === "active"
          ? "No active vaults."
          : "No archived vaults."
        : vaultCategory === "advanced"
          ? lifecycleMode === "active"
            ? "No active advanced vaults."
            : "No archived advanced vaults."
          : lifecycleMode === "active"
            ? "No active multi-asset vaults."
            : "No archived multi-asset vaults.";

    const hasVisible =
      vaultCategory === "regular"
        ? regularEntries.length > 0
        : vaultCategory === "advanced"
          ? advancedEntries.length > 0
          : betaEntries.length > 0;

    return (
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.cyan}
          />
        }
        testID={`history-vault-${vaultCategory}-${lifecycleMode}`}
      >
        {!hasVisible ? (
          <View style={styles.empty} testID="history-empty">
            <Feather name="inbox" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>{emptyCopy}</Text>
            <Text style={styles.emptyText}>
              Create a vault or switch tabs to see other types.
            </Text>
          </View>
        ) : null}

        {vaultCategory === "regular"
          ? regularEntries.map(renderVaultGroup)
          : null}
        {vaultCategory === "multi-asset"
          ? betaEntries.map(renderBetaRow)
          : null}
        {vaultCategory === "advanced"
          ? advancedEntries.map(renderAdvancedRow)
          : null}
      </ScrollView>
    );
  }

  if (source === "wallet") {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.filterBar} testID="wallet-history-filter-bar">
          <TouchableOpacity
            onPress={() => setFilterMenuOpen(true)}
            style={styles.filterDropdown}
            testID="wallet-history-filter-dropdown"
            activeOpacity={0.75}
          >
            <Feather
              name={WALLET_FILTER_META[walletFilter].icon}
              size={14}
              color={colors.cyan}
            />
            <Text style={styles.filterDropdownLabel}>
              {WALLET_FILTER_META[walletFilter].label}
            </Text>
            <View style={styles.filterCountBadge}>
              <Text style={styles.filterCountBadgeText}>
                {walletFilterCounts[walletFilter]}
              </Text>
            </View>
            <Feather
              name="chevron-down"
              size={14}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChipsRow}
          >
            {(Object.keys(WALLET_FILTER_META) as WalletFilter[]).map((k) => {
              const active = walletFilter === k;
              const meta = WALLET_FILTER_META[k];
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => setWalletFilter(k)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  testID={`wallet-history-filter-${k}`}
                  activeOpacity={0.75}
                >
                  <Feather
                    name={meta.icon}
                    size={11}
                    color={active ? colors.textInverse : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.filterChipText,
                      active && styles.filterChipTextActive,
                    ]}
                  >
                    {meta.label}
                  </Text>
                  <View
                    style={[
                      styles.filterChipCount,
                      active && styles.filterChipCountActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipCountText,
                        active && styles.filterChipCountTextActive,
                      ]}
                    >
                      {walletFilterCounts[k]}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      <FlatList
        data={walletFeedFiltered}
        keyExtractor={(f) =>
          f.source === "vault"
            ? `v:${f.tx.tx_id}`
            : f.source === "ttl_renewal"
              ? `r:${f.tx.id}`
              : `p:${f.tx.id}`
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.cyan}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          if (item.source === "vault") {
            const t = item.tx;
            const meta = META[t.kind];
            return (
              <View style={styles.row} testID={`tx-row-${t.tx_id}`}>
                <View
                  style={[styles.iconWrap, { backgroundColor: hex(meta.color, 0.15) }]}
                >
                  <Feather name={meta.icon} size={16} color={meta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.kind}>{meta.label}</Text>
                  <Text style={styles.note}>
                    {t.note || `Vault ${t.vault_id.slice(0, 8)}`}
                  </Text>
                  <Text style={styles.time}>{formatTimestamp(t.timestamp)}</Text>
                </View>
                {t.amount > 0 ? (
                  <Text
                    style={[
                      styles.amount,
                      {
                        color:
                          t.kind === "withdraw" ? colors.text : colors.teal,
                      },
                    ]}
                  >
                    {t.kind === "withdraw" ? "-" : "+"}
                    {formatXlm(t.amount)}
                  </Text>
                ) : null}
              </View>
            );
          }
          if (item.source === "ttl_renewal") {
            const r = item.tx;
            const feeXlm = stroopsToXlmString(r.feeStroops);
            return (
              <View style={styles.row} testID={`tx-row-renewal-${r.id}`}>
                <View
                  style={[styles.iconWrap, { backgroundColor: hex(colors.gold, 0.15) }]}
                >
                  <Feather name="shield" size={16} color={colors.gold} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.renewalTitleRow}>
                    <Text style={[styles.kind, { flex: 1 }]} numberOfLines={1}>
                      Vault Renewal - {r.vaultName}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert(
                          "About this entry",
                          `On-chain data renewal for vault ${r.vaultName}. Stellar network fee.`,
                        )
                      }
                      style={styles.renewalInfoBtn}
                      testID={`tx-row-renewal-info-${r.id}`}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="What is this entry?"
                    >
                      <Feather name="help-circle" size={13} color={colors.textTertiary} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.note}>Stellar network fee</Text>
                  <Text style={styles.time}>{formatTimestamp(Math.floor(r.timestampMs / 1000))}</Text>
                </View>
                <Text style={[styles.amount, { color: colors.textSecondary }]}>
                  -{feeXlm} XLM
                </Text>
              </View>
            );
          }
          const p = item.tx;
          const meta = PAYMENT_META[p.kind];
          const isSwapMemo =
            p.kind === "send" &&
            p.memo_type &&
            p.memo_type.toLowerCase().includes("text") &&
            /^\d+$/.test(p.memo.trim());
          const memoTag = isSwapMemo
            ? "Swap deposit"
            : p.memo
            ? `Memo: ${p.memo}`
            : "";
          return (
            <View style={styles.row} testID={`tx-row-payment-${p.id}`}>
              <View
                style={[styles.iconWrap, { backgroundColor: hex(meta.color, 0.15) }]}
              >
                <Feather name={meta.icon} size={16} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.kind}>{meta.label}</Text>
                <Text style={styles.note} numberOfLines={1}>
                  {p.kind === "send"
                    ? `To ${shortenAddress(p.counterparty, 6, 6)}`
                    : `From ${shortenAddress(p.counterparty, 6, 6)}`}
                  {memoTag ? ` · ${memoTag}` : ""}
                </Text>
                <Text style={styles.time}>{formatTimestamp(p.timestamp)}</Text>
              </View>
              <Text
                style={[
                  styles.amount,
                  { color: p.kind === "send" ? colors.text : colors.teal },
                ]}
              >
                {p.kind === "send" ? "-" : "+"}
                {formatXlm(p.amount)}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="activity" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>
              {walletFilter === "all"
                ? "No activity yet"
                : `No ${WALLET_FILTER_META[walletFilter].label.toLowerCase()} activity`}
            </Text>
            <Text style={styles.emptyText}>
              {walletFilter === "all"
                ? "Send or receive XLM to start the ledger."
                : "Try a different filter or pull to refresh."}
            </Text>
          </View>
        }
      />
      <FilterMenuModal
        visible={filterMenuOpen}
        onClose={() => setFilterMenuOpen(false)}
        current={walletFilter}
        counts={walletFilterCounts}
        onPick={(k) => {
          setWalletFilter(k);
          setFilterMenuOpen(false);
        }}
      />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(t) => t.tx_id}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.cyan}
        />
      }
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      // The collapsible archive list is only shown for the vaults source.
      // From /wallet the user doesn't need vault-archive scrollers.
      ListHeaderComponent={null}
      renderItem={({ item }) => {
        const meta = META[item.kind];
        return (
          <View style={styles.row} testID={`tx-row-${item.tx_id}`}>
            <View
              style={[styles.iconWrap, { backgroundColor: hex(meta.color, 0.15) }]}
            >
              <Feather name={meta.icon} size={16} color={meta.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.kind}>{meta.label}</Text>
              <Text style={styles.note}>
                {item.note || `Vault ${item.vault_id.slice(0, 8)}`}
              </Text>
              <Text style={styles.time}>{formatTimestamp(item.timestamp)}</Text>
            </View>
            {item.amount > 0 ? (
              <Text
                style={[
                  styles.amount,
                  {
                    color:
                      item.kind === "withdraw" ? colors.text : colors.teal,
                  },
                ]}
              >
                {item.kind === "withdraw" ? "-" : "+"}
                {formatXlm(item.amount)}
              </Text>
            ) : null}
          </View>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Feather name="activity" size={28} color={colors.textTertiary} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyText}>
            {source === "wallet"
              ? "Send or receive XLM to start the ledger."
              : "Create your first vault to start the ledger."}
          </Text>
        </View>
      }
    />
  );
}

function hex(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

function FilterMenuModal({
  visible,
  onClose,
  current,
  counts,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  current: WalletFilter;
  counts: Record<WalletFilter, number>;
  onPick: (k: WalletFilter) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.filterBackdrop} onPress={onClose} />
      <View style={styles.filterSheet} testID="wallet-history-filter-menu">
        <Text style={styles.filterSheetTitle}>Filter transactions</Text>
        {(Object.keys(WALLET_FILTER_META) as WalletFilter[]).map((k) => {
          const meta = WALLET_FILTER_META[k];
          const active = current === k;
          return (
            <TouchableOpacity
              key={k}
              onPress={() => onPick(k)}
              style={[
                styles.filterSheetRow,
                active && styles.filterSheetRowActive,
              ]}
              testID={`wallet-history-filter-menu-${k}`}
              activeOpacity={0.75}
            >
              <View
                style={[
                  styles.filterSheetIcon,
                  active && styles.filterSheetIconActive,
                ]}
              >
                <Feather
                  name={meta.icon}
                  size={16}
                  color={active ? colors.cyan : colors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.filterSheetLabel,
                    active && styles.filterSheetLabelActive,
                  ]}
                >
                  {meta.label}
                </Text>
                <Text style={styles.filterSheetCount}>
                  {counts[k]} {counts[k] === 1 ? "entry" : "entries"}
                </Text>
              </View>
              {active ? (
                <Feather name="check" size={16} color={colors.cyan} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  title: { color: colors.text, fontSize: 26, ...typography.display },
  sub: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },

  // Wallet ⇄ Vaults toggle under the header title.
  segRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.md,
    padding: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    alignSelf: "flex-start",
  },
  segBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  segBtnActive: {
    backgroundColor: colors.cyan,
  },
  segText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  segTextActive: {
    color: colors.textInverse,
  },
  categoryRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    paddingRight: spacing.md,
  },
  categoryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  categoryBtnActive: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.teal,
  },
  categoryText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  categoryTextActive: {
    color: colors.teal,
  },
  lifecycleRow: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 4,
    marginTop: spacing.sm,
    padding: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  lifecycleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  lifecycleBtnActive: {
    backgroundColor: colors.teal,
  },
  lifecycleText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  lifecycleTextActive: {
    color: colors.textInverse,
  },
  list: {
    paddingHorizontal: spacing.md,
    // Extra bottom padding so last row isn't clipped by tab bar (64px + safe area).
    paddingBottom: spacing.xl + 96,
  },
  loadingWrap: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
    gap: 10,
  },
  loadingText: { color: colors.textSecondary, fontSize: 13 },
  vaultGroup: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...tileShadow(),
  },
  vaultGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  vaultGroupTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  vaultGroupName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
    maxWidth: 220,
  },
  vaultArchivedBadge: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  vaultArchivedBadgeText: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  historyTypeBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  historyTypeBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  vaultGroupSub: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  vaultGroupBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  archiveSection: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated ?? colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
  },
  archiveHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  archiveHeaderLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  archiveBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingBottom: spacing.sm,
    paddingHorizontal: 0,
    // Reset margins on child vaultGroup blocks — but we can't override
    // nested styles here; the nested marginHorizontal already provides
    // the inset visual, so we set it to negative to align inside.
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 14,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  kind: { color: colors.text, fontSize: 14, fontWeight: "600" },
  renewalTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  renewalInfoBtn: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  note: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  time: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  amount: { fontSize: 13, fontWeight: "700", ...typography.mono },
  sep: { height: 1, backgroundColor: colors.borderSubtle },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: 8 },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    ...typography.heading,
    marginTop: 8,
  },
  emptyText: { color: colors.textSecondary, fontSize: 13 },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  filterBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  filterDropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  filterDropdownLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },
  filterCountBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 11,
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderGlow,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountBadgeText: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "800",
  },
  filterChipsRow: {
    flexDirection: "row",
    gap: 6,
    paddingRight: 6,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  filterChipActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: colors.textInverse,
  },
  filterChipCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipCountActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  filterChipCountText: {
    color: colors.textTertiary,
    fontSize: 9,
    fontWeight: "800",
  },
  filterChipCountTextActive: {
    color: colors.textInverse,
  },
  filterBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  filterSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.md + 4,
    paddingBottom: spacing.xl,
    gap: 4,
  },
  filterSheetTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  filterSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  filterSheetRowActive: {
    backgroundColor: colors.cyanMuted,
    borderColor: colors.borderGlow,
  },
  filterSheetIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceElevated,
  },
  filterSheetIconActive: {
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
  },
  filterSheetLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  filterSheetLabelActive: {
    color: colors.cyan,
  },
  filterSheetCount: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  walletEmpty: {
    flex: 1,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  walletEmptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  walletEmptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 8,
    textAlign: "center",
  },
  walletEmptyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  walletEmptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.teal,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radii.pill,
    minHeight: 48,
  },
  walletEmptyBtnText: {
    color: colors.textInverse,
    fontWeight: "800",
    fontSize: 14,
  },
});
