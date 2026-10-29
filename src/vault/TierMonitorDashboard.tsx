import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Vault } from "@/src/api/client";
import { useSession } from "@/src/state/session";
import {
  getCurrentTier,
  getTierConfig,
  hasTierAccess,
  hydrateTier,
  isVaultTypeComingSoon,
  TIER_DASHBOARD_TABS,
  TIER_CONFIGS,
  toTierVaultType,
  VAULT_TYPE_LABELS,
  type TierId,
  type TierVaultType,
} from "@/src/tiers/tier-config";
import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { formatDaysRemaining } from "@/src/vault/countdown";
import {
  loadTierMonitorPrefs,
  saveTierMonitorPrefs,
  type SortKey,
  type StatusFilter,
  type WidgetSize,
} from "@/src/vault/tier-monitor-store";
import {
  useVaultSessionData,
  type MultiSigSessionRow,
} from "@/src/vault/useVaultSessionData";
import {
  deriveHtlcStatusFromAdvancedVault,
  htlcLifecycleToUnifiedStatus,
  stroopsToFloat,
  type AdvancedVaultRecord,
} from "@/src/wallet/advanced-vaults";
import {
  tokenSymbolForAddress,
  type BetaVaultRecord,
} from "@/src/wallet/multi-asset-beta";

type MonitorStatus = "locked" | "unlocked" | "withdrawn";

/** Dashboard tab state — either "All" (grouped view) or a specific vault type. */
type TierTab = TierVaultType | "All";

export interface MonitorPosition {
  id: string;
  name: string;
  kindLabel: string;
  vaultType: TierVaultType;
  balance: number;
  balanceLabel: string;
  status: MonitorStatus;
  unlockTimestamp: number;
  timeLabel: string;
  /** PENDING APPROVAL | ACTIVE | COMPLETED — Multi-Sig status badge */
  roleLabel?: string;
  /** Multi-Sig contract C-address for navigation */
  multiSigContractId?: string;
  /** HTLC vault id on the dedicated shared contract */
  htlcVaultId?: string;
}

export type TierVariant = "plus" | "pro" | "institutional";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "name", label: "Name" },
  { key: "unlock", label: "Unlock" },
  { key: "status", label: "Status" },
];

const FILTER_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "locked", label: "Locked" },
  { key: "unlocked", label: "Ready" },
  { key: "withdrawn", label: "Closed" },
];

const SIZE_OPTIONS: { key: WidgetSize; label: string }[] = [
  { key: "sm", label: "S" },
  { key: "md", label: "M" },
  { key: "lg", label: "L" },
];

function statusOfStandard(v: Vault): MonitorStatus {
  if (v.status === "withdrawn" || v.status === "archived") return "withdrawn";
  if (v.status === "unlocked") return "unlocked";
  return "locked";
}

function statusOfBeta(v: BetaVaultRecord, nowSec: number): MonitorStatus {
  if (v.withdrawn) return "withdrawn";
  if (v.unlockTimestamp <= nowSec) return "unlocked";
  return "locked";
}

function statusOfAdvanced(v: AdvancedVaultRecord, nowSec: number): MonitorStatus {
  if (v.kind === "HTLC") {
    return htlcLifecycleToUnifiedStatus(deriveHtlcStatusFromAdvancedVault(v, nowSec));
  }
  if (v.withdrawn || v.claimedByBackup) return "withdrawn";
  if (v.unlockTimestamp > 0 && v.unlockTimestamp <= nowSec) return "unlocked";
  if (
    (v.kind === "Vesting" || v.kind === "MultiAssetVesting") &&
    v.vestingEndTimestamp > 0 &&
    v.vestingEndTimestamp <= nowSec
  ) {
    return "unlocked";
  }
  if (
    v.kind === "DeadManSwitch" &&
    v.lastPingTimestamp + v.inactivityPeriodSeconds <= nowSec
  ) {
    return "unlocked";
  }
  return "locked";
}

function kindLabelFor(
  variant: TierVariant,
  source: "standard" | "multi" | "advanced",
  advancedKind?: string,
): string {
  if (variant === "institutional") {
    if (source === "standard" || advancedKind === "TimeLock") return "Time-Lock";
    if (source === "multi") return "Multi-asset";
    if (advancedKind === "CoolingOff") return "Cooling-off";
    if (advancedKind === "Vesting") return "Vesting";
    if (advancedKind === "MultiAssetVesting") return "Multi-asset vesting";
    if (advancedKind === "DeadManSwitch") return "Dead man's switch";
    if (advancedKind === "MultiSig") return "Multi-sig";
    if (advancedKind === "HTLC") return "HTLC";
    return advancedKind ?? "Vault";
  }
  if (source === "standard" || advancedKind === "TimeLock") return "Time-Lock";
  if (source === "multi") return "Multi-Asset";
  if (advancedKind === "CoolingOff") return "Cooling-Off";
  if (advancedKind === "Vesting") return "Vesting Schedule";
  if (advancedKind === "MultiAssetVesting") return "Multi-Asset Vesting";
  if (advancedKind === "DeadManSwitch") return "Dead Man's Switch";
  if (advancedKind === "MultiSig") return "Multi-Sig";
  if (advancedKind === "HTLC") return "HTLC";
  return advancedKind ?? "Advanced";
}

function buildPositions(
  variant: TierVariant,
  standard: Vault[],
  beta: BetaVaultRecord[],
  advanced: AdvancedVaultRecord[],
  multiSig: MultiSigSessionRow[],
  formatXlm: (n: number) => string,
): MonitorPosition[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const out: MonitorPosition[] = [];

  for (const v of standard) {
    const balance = Number.isFinite(v.balance) ? v.balance : 0;
    const status = statusOfStandard(v);
    if (status !== "withdrawn" && balance <= 0) continue;
    out.push({
      id: `standard:${v.vault_id}`,
      name: v.name?.trim() || `Vault ${v.vault_id.slice(0, 8)}…`,
      kindLabel: kindLabelFor(variant, "standard"),
      vaultType: "TimeLock",
      balance,
      balanceLabel: formatXlm(balance),
      status,
      unlockTimestamp: v.unlock_timestamp,
      timeLabel:
        status === "withdrawn"
          ? "Closed"
          : formatDaysRemaining(v.unlock_timestamp),
    });
  }

  for (const v of beta) {
    const status = statusOfBeta(v, nowSec);
    const symbol = tokenSymbolForAddress(v.tokenContractId) ?? "TOKEN";
    const amountFloat = Number(v.balance) / 10_000_000;
    out.push({
      id: `multi:${v.vaultId.toString()}`,
      name: v.name?.trim() || `Vault #${v.vaultId.toString()}`,
      kindLabel: kindLabelFor(variant, "multi"),
      vaultType: "MultiAsset",
      balance: amountFloat,
      balanceLabel: `${amountFloat.toFixed(2)} ${symbol}`,
      status,
      unlockTimestamp: v.unlockTimestamp,
      timeLabel:
        status === "withdrawn"
          ? "Closed"
          : formatDaysRemaining(v.unlockTimestamp),
    });
  }

  for (const v of advanced) {
    const status = statusOfAdvanced(v, nowSec);
    const bal = stroopsToFloat(v.balance);
    const vaultType = toTierVaultType("advanced", v.kind);
    // Include kind in the id so watchlist entries can't collide across types.
    out.push({
      id: `advanced:${v.kind}:${v.vaultId.toString()}`,
      name: v.name?.trim() || `Adv #${v.vaultId.toString()}`,
      kindLabel: kindLabelFor(variant, "advanced", v.kind),
      vaultType,
      balance: bal,
      balanceLabel: formatXlm(bal),
      status,
      unlockTimestamp: v.unlockTimestamp,
      timeLabel:
        status === "withdrawn"
          ? v.kind === "HTLC"
            ? deriveHtlcStatusFromAdvancedVault(v, nowSec) === "refunded"
              ? "Refunded"
              : "Claimed"
            : "Closed"
          : v.kind === "HTLC"
            ? (() => {
                const life = deriveHtlcStatusFromAdvancedVault(v, nowSec);
                if (life === "claimable") return "Claimable";
                if (life === "expired") return "Expired — refundable";
                return "HTLC locked";
              })()
          : v.kind === "CoolingOff" && v.withdrawalInitiatedTimestamp > 0
            ? formatDaysRemaining(
                v.withdrawalInitiatedTimestamp + v.coolingOffDurationSeconds,
              )
            : v.kind === "DeadManSwitch"
              ? formatDaysRemaining(
                  v.lastPingTimestamp + v.inactivityPeriodSeconds,
                )
              : (v.kind === "Vesting" || v.kind === "MultiAssetVesting") &&
                  v.vestingEndTimestamp > 0
                ? formatDaysRemaining(v.vestingEndTimestamp)
                : formatDaysRemaining(v.unlockTimestamp),
      roleLabel:
        v.kind === "HTLC"
          ? v.isBeneficiary
            ? "RECIPIENT"
            : "SENDER"
          : undefined,
      htlcVaultId: v.kind === "HTLC" ? v.vaultId.toString() : undefined,
    });
  }

  // Per-contract Multi-Sig vaults (not indexed by mav_v2 list_vaults).
  for (const row of multiSig) {
    const completed = row.balanceXlm <= 0 && !row.pendingApproval;
    out.push({
      id: `msig:${row.entry.contractId}`,
      name: "Multi-Sig Vault",
      kindLabel: kindLabelFor(variant, "advanced", "MultiSig"),
      vaultType: "MultiSig",
      balance: row.balanceXlm,
      balanceLabel: formatXlm(row.balanceXlm),
      // Completed → withdrawn so active totals / filters exclude them.
      status: completed ? "withdrawn" : "locked",
      unlockTimestamp: row.unlockTimestamp,
      timeLabel: completed
        ? "Completed"
        : row.pendingApproval
          ? "Awaiting co-signer"
          : row.unlockTimestamp > 0
            ? formatDaysRemaining(row.unlockTimestamp)
            : "Multi-Sig",
      roleLabel: completed
        ? "COMPLETED"
        : row.pendingApproval
          ? "PENDING APPROVAL"
          : "ACTIVE",
      multiSigContractId: row.entry.contractId,
    });
  }

  return out;
}

function statusRank(s: MonitorStatus): number {
  if (s === "unlocked") return 0;
  if (s === "locked") return 1;
  return 2;
}

function requiredTierForVariant(variant: TierVariant): Exclude<TierId, "free"> {
  if (variant === "plus") return "plus";
  if (variant === "pro") return "pro";
  return "elite";
}

export function TierMonitorDashboard({
  variant,
  title,
  badge,
  subtitle,
  embedded = false,
}: {
  variant: TierVariant;
  title: string;
  badge: string;
  subtitle: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { wallet, formatXlm } = useSession();
  const requiredTier = requiredTierForVariant(variant);
  const tabs = TIER_DASHBOARD_TABS[requiredTier];
  const {
    standard,
    beta,
    advanced,
    multiSig,
    loading: vaultsLoading,
    refreshing: vaultsRefreshing,
    error: vaultsError,
    refresh: refreshVaults,
  } = useVaultSessionData();

  const [userTier, setUserTier] = useState<TierId>(getCurrentTier());
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [watchlistCustomized, setWatchlistCustomized] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("balance");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [widgetSize, setWidgetSize] = useState<WidgetSize>("md");
  const [query, setQuery] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);
  // Default: "All" → grouped dashboard showing every vault type this tier
  // can create/monitor, with per-type section headers.
  const [kindTab, setKindTab] = useState<TierTab>("All");

  const hasAccess = hasTierAccess(requiredTier, userTier);
  const requiredCfg = TIER_CONFIGS[requiredTier];
  const userCfg = getTierConfig(userTier);

  const positions = useMemo(
    () =>
      buildPositions(
        variant,
        standard ?? [],
        beta,
        advanced,
        multiSig,
        formatXlm,
      ),
    [variant, standard, beta, advanced, multiSig, formatXlm],
  );

  const loading = vaultsLoading && standard == null;
  const error = vaultsError;

  useEffect(() => {
    void hydrateTier().then(setUserTier);
  }, []);

  // Hydrate monitor prefs once per wallet/variant.
  useEffect(() => {
    let cancelled = false;
    setPrefsReady(false);
    (async () => {
      if (!wallet) {
        setWatchedIds([]);
        setKnownIds([]);
        setWatchlistCustomized(false);
        return;
      }
      const prefs = await loadTierMonitorPrefs(variant, wallet.publicKey);
      if (cancelled) return;
      setWatchlistCustomized(prefs.watchlistCustomized);
      setWatchedIds(prefs.watchedIds);
      setKnownIds(prefs.knownIds);
      setSortKey(prefs.sortKey);
      setStatusFilter(prefs.statusFilter);
      setWidgetSize(prefs.widgetSize);
      setPrefsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet?.publicKey, variant, wallet]);

  // Auto-watch newly discovered positions (keeps Cooling-Off / Vesting / DMS
  // visible on their tier tabs after the user customized an older watchlist).
  useEffect(() => {
    if (!prefsReady) return;
    const builtIds = positions.map((p) => p.id);
    setKnownIds((prevKnown) => {
      const known = new Set(prevKnown);
      // Also treat legacy `advanced:<id>` as knowing `advanced:<Kind>:<id>`.
      for (const id of prevKnown) {
        if (id.startsWith("advanced:") && id.split(":").length === 2) {
          known.add(id);
        }
      }
      const brandNew = builtIds.filter((id) => {
        if (known.has(id)) return false;
        // Legacy watchlist entry without kind prefix.
        const parts = id.split(":");
        if (parts[0] === "advanced" && parts.length === 3) {
          const legacy = `advanced:${parts[2]}`;
          if (known.has(legacy)) return false;
        }
        return true;
      });
      setWatchedIds((prevWatched) => {
        if (!watchlistCustomized) {
          if (
            prevWatched.length === builtIds.length &&
            prevWatched.every((id, i) => id === builtIds[i])
          ) {
            return prevWatched;
          }
          return builtIds;
        }
        if (brandNew.length === 0) return prevWatched;
        return Array.from(new Set([...prevWatched, ...brandNew]));
      });
      const next = Array.from(new Set([...prevKnown, ...builtIds]));
      return next.length === prevKnown.length ? prevKnown : next;
    });
  }, [prefsReady, positions, watchlistCustomized]);

  useEffect(() => {
    if (!wallet || !prefsReady || !hasAccess) return;
    void saveTierMonitorPrefs(variant, wallet.publicKey, {
      watchedIds,
      knownIds,
      watchlistCustomized,
      sortKey,
      statusFilter,
      widgetSize,
    });
  }, [
    wallet,
    prefsReady,
    hasAccess,
    variant,
    watchedIds,
    knownIds,
    watchlistCustomized,
    sortKey,
    statusFilter,
    widgetSize,
  ]);

  const toggleWatch = useCallback((id: string) => {
    setWatchlistCustomized(true);
    setWatchedIds((prev) => {
      const parts = id.split(":");
      const legacy =
        parts[0] === "advanced" && parts.length === 3
          ? `advanced:${parts[2]}`
          : null;
      const currentlyOn =
        prev.includes(id) || (legacy != null && prev.includes(legacy));
      if (currentlyOn) {
        return prev.filter((x) => x !== id && x !== legacy);
      }
      return [...prev, id];
    });
  }, []);

  const openCreateVault = useCallback(
    (type?: TierVaultType) => {
      if (!hasAccess) {
        return;
      }
      let t = type;
      if (!t) {
        if (kindTab === "All") {
          t = tabs[0]?.key || "TimeLock";
        } else {
          t = kindTab;
        }
      }
      if (isVaultTypeComingSoon(t)) {
        toast.show("This vault type is coming soon", "info");
        return;
      }
      if (t === "HTLC") {
        router.push({
          pathname: "/create-vault",
          params: { tab: "advanced", type: "HTLC" },
        } as never);
        return;
      }
      if (t === "TimeLock") {
        router.push("/create-vault" as never);
        return;
      }
      if (t === "MultiAsset") {
        router.push({ pathname: "/create-vault", params: { type: "MultiAsset" } } as never);
        return;
      }
      router.push({
        pathname: "/create-vault",
        params: { tab: "advanced", type: t },
      } as never);
    },
    [hasAccess, kindTab, router, toast],
  );

  const tabPositions = useMemo(() => {
    if (kindTab === "All") {
      const allowed = new Set(tabs.map((t) => t.key));
      return positions.filter((p) => allowed.has(p.vaultType));
    }
    return positions.filter((p) => p.vaultType === kindTab);
  }, [positions, kindTab, tabs]);

  const isWatched = useCallback(
    (positionId: string) => {
      if (watchedIds.includes(positionId)) return true;
      // Legacy prefs used `advanced:<vaultId>` before kind was included.
      const parts = positionId.split(":");
      if (parts[0] === "advanced" && parts.length === 3) {
        return watchedIds.includes(`advanced:${parts[2]}`);
      }
      return false;
    },
    [watchedIds],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = tabPositions.filter((p) => isWatched(p.id));
    if (statusFilter !== "all") {
      rows = rows.filter((p) => p.status === statusFilter);
    }
    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.kindLabel.toLowerCase().includes(q),
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sortKey === "balance") return b.balance - a.balance;
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "unlock") return a.unlockTimestamp - b.unlockTimestamp;
      return statusRank(a.status) - statusRank(b.status);
    });
    return sorted;
  }, [tabPositions, isWatched, statusFilter, query, sortKey]);

  // Grouped view — only used when the "All" tab is active.
  const grouped = useMemo<{ type: TierVaultType; label: string; items: MonitorPosition[] }[] | null>(() => {
    if (kindTab !== "All") return null;
    const byType = new Map();
    for (const p of visible) {
      const arr = byType.get(p.vaultType) || [];
      arr.push(p);
      byType.set(p.vaultType, arr);
    }
    return tabs
      .map((t) => ({
        type: t.key,
        label: t.label,
        items: byType.get(t.key) || [],
      }))
      .filter((g) => g.items.length > 0);
  }, [kindTab, visible, tabs]);

  const totals = useMemo(() => {
    const active = visible.filter((p) => p.status !== "withdrawn");
    const sum = active.reduce((acc, p) => acc + p.balance, 0);
    const locked = active.filter((p) => p.status === "locked").length;
    const ready = active.filter((p) => p.status === "unlocked").length;
    return { sum, locked, ready, count: active.length };
  }, [visible]);

  const sizeFor = useCallback(
    (p: MonitorPosition, index: number): WidgetSize => {
      if (widgetSize === "sm") return "sm";
      if (widgetSize === "lg") {
        return index < 2 || p.balance >= totals.sum * 0.2 ? "lg" : "md";
      }
      return index === 0 || p.balance >= totals.sum * 0.25 ? "lg" : "md";
    },
    [widgetSize, totals.sum],
  );

  // Active tab display label (avoids "All" hitting VAULT_TYPE_LABELS).
  const previewLabel =
    kindTab === "All" ? "All vault types" : VAULT_TYPE_LABELS[kindTab];
  const kindLabel = kindTab === "All" ? "" : VAULT_TYPE_LABELS[kindTab];

  const content = (
    <>
      {!hasAccess ? (
          <View style={styles.upgradeCard} testID={`${variant}-upgrade-prompt`}>
            <Feather name="lock" size={18} color={colors.gold} />
            <Text style={styles.upgradeTitle}>
              Upgrade to {requiredCfg.label}
            </Text>
            <Text style={styles.upgradeBody}>
              You're on {userCfg.label}. {requiredCfg.label} ({requiredCfg.priceLabel}) unlocks{" "}
              {requiredCfg.vaultTypes.map((t) => VAULT_TYPE_LABELS[t]).join(", ")}
              {requiredCfg.vaultLimit != null
                ? ` · up to ${requiredCfg.vaultLimit} vaults`
                : " · unlimited vaults"}
              {requiredCfg.monthlyDepositLimitUsd != null
                ? ` · $${requiredCfg.monthlyDepositLimitUsd.toLocaleString()}/mo deposits`
                : " · no deposit limit"}
              .
            </Text>
            <Text style={styles.upgradeHint}>
              Preview below — set Test Tier Selection in Settings to try this dashboard.
            </Text>
            <TouchableOpacity
              style={styles.upgradeCta}
              onPress={() => router.push("/settings" as never)}
              testID={`${variant}-open-settings-tier`}
            >
              <Text style={styles.upgradeCtaText}>Open Settings</Text>
              <Feather name="chevron-right" size={16} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.monitorNote}>
            <Feather name="eye" size={13} color={colors.textTertiary} />
            <Text style={styles.monitorNoteText}>
              {variant === "plus"
                ? "Plus monitoring · create Cooling-Off and Time-Lock vaults"
                : variant === "pro"
                  ? "Pro dashboard · create and monitor your unlocked vault types"
                  : "Your vaults. Create or open one below."}
            </Text>
          </View>
        )}

        <Text style={styles.controlLabel}>VAULT TYPES</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
          testID={`${variant}-kind-tabs`}
        >
          <Chip
            label="All"
            active={kindTab === "All"}
            onPress={() => setKindTab("All")}
            testID={`${variant}-tab-All`}
          />
          {tabs.map((t) => (
            <Chip
              key={t.key}
              label={t.label}
              active={kindTab === t.key}
              onPress={() => setKindTab(t.key)}
              testID={`${variant}-tab-${t.key}`}
            />
          ))}
        </ScrollView>

        {!hasAccess ? (
          <View style={styles.previewBox} testID={`${variant}-type-preview`}>
            <Text style={styles.previewTitle}>
              {previewLabel} on {requiredCfg.label}
            </Text>
            <Text style={styles.previewBody}>
              Unlock this vault type with {requiredCfg.label}. Your current plan
              ({userCfg.label}) can{" "}
              {kindTab !== "All" && userCfg.vaultTypes.includes(kindTab)
                ? "already use this type from the wallet New Vault flow."
                : "not create this type yet."}
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.cyan} style={{ marginTop: 16 }} />
            ) : (
              <Text style={styles.previewCount}>
                {tabPositions.length} matching vault
                {tabPositions.length === 1 ? "" : "s"} on this wallet
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, styles.summaryWide]}>
                <Text style={variant === "institutional" ? styles.eliteSummaryLabel : styles.summaryLabel}>
                  {variant === "institutional" ? "WATCHED TOTAL" : "TRACKED BALANCE"}
                </Text>
                <Text style={variant === "institutional" ? styles.eliteSummaryValue : styles.summaryValue} numberOfLines={1}>
                  {formatXlm(totals.sum)}
                </Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>LOCKED</Text>
                <Text style={styles.summaryValueSm}>{totals.locked}</Text>
              </View>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>READY</Text>
                <Text style={styles.summaryValueSm}>{totals.ready}</Text>
              </View>
            </View>

            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder={
                variant === "institutional"
                  ? "Find a vault…"
                  : "Filter trackers…"
              }
              placeholderTextColor={colors.textTertiary}
              testID={`${variant}-tier-search`}
            />

            {variant === "institutional" ? (
              <TouchableOpacity
                onPress={() => setArrangeOpen((v) => !v)}
                style={styles.arrangeBtn}
                testID={`${variant}-arrange-toggle`}
              >
                <Text style={styles.manageLink}>
                  {arrangeOpen ? "Hide options" : "Arrange"}
                </Text>
              </TouchableOpacity>
            ) : null}

            {variant !== "institutional" || arrangeOpen ? (
            <View style={styles.controls}>
              <Text style={styles.controlLabel}>SORT</Text>
              <View style={styles.chipRow}>
                {SORT_OPTIONS.map((o) => (
                  <Chip
                    key={o.key}
                    label={o.label}
                    active={sortKey === o.key}
                    onPress={() => setSortKey(o.key)}
                    testID={`${variant}-sort-${o.key}`}
                  />
                ))}
              </View>
              <Text style={[styles.controlLabel, { marginTop: spacing.sm }]}>
                FILTER
              </Text>
              <View style={styles.chipRow}>
                {FILTER_OPTIONS.map((o) => (
                  <Chip
                    key={o.key}
                    label={o.label}
                    active={statusFilter === o.key}
                    onPress={() => setStatusFilter(o.key)}
                    testID={`${variant}-filter-${o.key}`}
                  />
                ))}
              </View>
              <Text style={[styles.controlLabel, { marginTop: spacing.sm }]}>
                WIDGET SIZE
              </Text>
              <View style={styles.chipRow}>
                {SIZE_OPTIONS.map((o) => (
                  <Chip
                    key={o.key}
                    label={o.label}
                    active={widgetSize === o.key}
                    onPress={() => setWidgetSize(o.key)}
                    testID={`${variant}-size-${o.key}`}
                  />
                ))}
              </View>
            </View>
            ) : null}

            <View style={styles.listHeader}>
              <Text style={styles.section}>
                {variant === "institutional"
                  ? `Vaults · ${visible.length}`
                  : `TRACKERS · ${visible.length}`}
              </Text>
              <TouchableOpacity
                onPress={() => setManageOpen((v) => !v)}
                testID={`${variant}-manage-trackers`}
              >
                <Text style={styles.manageLink}>
                  {manageOpen ? "Done" : "Add / Remove"}
                </Text>
              </TouchableOpacity>
            </View>

            {manageOpen ? (
              <View style={styles.manageBox} testID={`${variant}-manage-panel`}>
                {tabPositions.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No {kindLabel} vaults on this wallet.
                  </Text>
                ) : (
                  tabPositions.map((p) => {
                    const on = isWatched(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.manageRow}
                        onPress={() => toggleWatch(p.id)}
                        testID={`${variant}-watch-toggle-${p.id}`}
                      >
                        <Feather
                          name={on ? "check-square" : "square"}
                          size={16}
                          color={on ? colors.cyan : colors.textTertiary}
                        />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.manageName} numberOfLines={1}>
                            {p.name}
                          </Text>
                          <Text style={styles.manageMeta} numberOfLines={1}>
                            {p.kindLabel} · {p.balanceLabel}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            ) : null}

            {loading ? (
              <ActivityIndicator color={colors.cyan} style={{ marginTop: 24 }} />
            ) : !wallet ? (
              <View style={styles.emptyBox}>
                <Feather name="link" size={22} color={colors.textTertiary} />
                <Text style={styles.emptyText}>
                  Connect a wallet to view vaults.
                </Text>
              </View>
            ) : error ? (
              <Text style={styles.errorText}>{error}</Text>
            ) : visible.length === 0 ? (
              <View style={styles.emptyBox}>
                <Feather name="inbox" size={22} color={colors.textTertiary} />
                <Text style={styles.emptyText}>
                  {kindTab === "All"
                    ? "No watched vaults match this filter."
                    : `No watched ${VAULT_TYPE_LABELS[kindTab]} vaults match this filter.`}
                </Text>
                <TouchableOpacity
                  style={styles.emptyCreate}
                  onPress={() => openCreateVault(undefined)}
                  testID={`${variant}-empty-create`}
                >
                  <Feather name="plus" size={14} color={colors.cyan} />
                  <Text style={styles.emptyCreateText}>
                    New {kindLabel} Vault
                  </Text>
                </TouchableOpacity>
              </View>
            ) : kindTab === "All" && grouped ? (
              <View style={styles.groupedWrap}>
                {grouped.map((g) => (
                  <View key={g.type} style={styles.groupSection}>
                    <Text style={styles.groupHeader} testID={`${variant}-group-${g.type}`}>
                      {g.label}
                    </Text>
                    <View style={styles.grid}>
                      {g.items.map((p, idx) => (
                        <PositionCard
                          key={p.id}
                          position={p}
                          size={sizeFor(p, idx)}
                          variant={variant}
                          onPress={
                            p.multiSigContractId
                              ? () =>
                                  router.push(
                                    `/multi-sig/${p.multiSigContractId}` as never,
                                  )
                              : p.htlcVaultId
                                ? () =>
                                    router.push(
                                      `/htlc/${p.htlcVaultId}` as never,
                                    )
                                : undefined
                          }
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.grid}>
                {visible.map((p, idx) => (
                  <PositionCard
                    key={p.id}
                    position={p}
                    size={sizeFor(p, idx)}
                    variant={variant}
                    onPress={
                      p.multiSigContractId
                        ? () =>
                            router.push(
                              `/multi-sig/${p.multiSigContractId}` as never,
                            )
                        : p.htlcVaultId
                          ? () =>
                              router.push(`/htlc/${p.htlcVaultId}` as never)
                          : undefined
                    }
                  />
                ))}
              </View>
            )}
          </>
        )}
    </>
  );

  if (embedded) {
    return (
      <View
        style={styles.embeddedWrap}
        testID={`wallet-${variant}-tier-monitor`}
      >
        <View style={styles.embeddedBody}>{content}</View>
      </View>
    );
  }

  return (
    <SafeAreaView
      edges={["top"]}
      style={styles.root}
      testID={`${variant}-tier-screen`}
    >
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet")
          }
          style={styles.headerBack}
          hitSlop={12}
          accessibilityLabel="Back"
          testID={`${variant}-tier-back`}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.titleRow}>
            <Text style={variant === "institutional" ? styles.eliteTitle : styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.badge} testID={`${variant}-tier-badge`}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          </View>
          <Text style={variant === "institutional" ? styles.eliteSub : styles.headerSub} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        {hasAccess ? (
          <TouchableOpacity
            onPress={() => openCreateVault()}
            style={styles.newVaultBtn}
            testID={`${variant}-new-vault`}
            accessibilityRole="button"
            accessibilityLabel="Create a new vault"
          >
            <Feather name="plus" size={14} color={colors.cyan} />
            <Text style={styles.newVaultBtnText}>New Vault</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={vaultsRefreshing}
            onRefresh={() => {
              void refreshVaults();
            }}
            tintColor={colors.cyan}
          />
        }
      >
        {content}
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active ? styles.chipOn : null]}
      testID={testID}
      activeOpacity={0.75}
    >
      <Text style={[styles.chipText, active ? styles.chipTextOn : null]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function PositionCard({
  position,
  size,
  variant,
  onPress,
}: {
  position: MonitorPosition;
  size: WidgetSize;
  variant: TierVariant;
  onPress?: () => void;
}) {
  const statusColor =
    position.roleLabel === "PENDING APPROVAL"
      ? colors.gold
      : position.roleLabel === "COMPLETED"
        ? colors.statusClosed
        : position.status === "unlocked"
          ? colors.statusActive
          : position.status === "locked"
            ? colors.statusPending
            : colors.statusClosed;

  const body = (
    <>
      <View style={styles.cardTop}>
        <Text style={styles.cardKind} numberOfLines={1}>
          {position.kindLabel}
        </Text>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
      </View>
      {position.roleLabel ? (
        <Text style={styles.cardRole} numberOfLines={1}>
          {position.roleLabel}
        </Text>
      ) : null}
      <Text
        style={[styles.cardName, size === "sm" ? styles.cardNameSm : null]}
        numberOfLines={1}
      >
        {position.name}
      </Text>
      <Text
        style={[
          styles.cardBalance,
          size === "lg" ? styles.cardBalanceLg : null,
          size === "sm" ? styles.cardBalanceSm : null,
        ]}
        numberOfLines={1}
      >
        {position.balanceLabel}
      </Text>
      <Text style={styles.cardTime} numberOfLines={1}>
        {position.timeLabel}
      </Text>
    </>
  );

  const cardStyle = [
    styles.card,
    size === "lg" ? styles.cardLg : size === "sm" ? styles.cardSm : styles.cardMd,
  ];

  if (onPress) {
    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={onPress}
        activeOpacity={0.85}
        testID={`${variant}-position-${position.id}`}
      >
        {body}
      </TouchableOpacity>
    );
  }

  return (
    <View style={cardStyle} testID={`${variant}-position-${position.id}`}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    ...typography.heading,
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.gold + "22",
    borderWidth: 1,
    borderColor: colors.gold + "55",
  },
  badgeText: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  headerSub: { color: colors.textTertiary, fontSize: 11, marginTop: 2 },
  newVaultBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cyan + "66",
    backgroundColor: colors.cyanMuted,
  },
  newVaultBtnText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "700",
  },
  body: { padding: spacing.md, paddingBottom: 48 },
  monitorNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    marginBottom: spacing.md,
  },
  monitorNoteText: { flex: 1, color: colors.textTertiary, fontSize: 11, lineHeight: 15 },
  upgradeCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.gold + "55",
    backgroundColor: colors.gold + "10",
    padding: spacing.md,
    gap: 8,
    marginBottom: spacing.md,
    ...tileShadow(),
  },
  upgradeTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  upgradeBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  upgradeHint: {
    color: colors.textTertiary,
    fontSize: 11,
    lineHeight: 15,
  },
  upgradeCta: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.gold,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
  },
  upgradeCtaText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: "700",
  },
  previewBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    gap: 6,
  },
  previewTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  previewBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  previewCount: { color: colors.textTertiary, fontSize: 11, marginTop: 4 },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.sm,
    ...tileShadow(),
  },
  summaryWide: { flex: 2.2 },
  summaryLabel: {
    color: colors.textTertiary,
    fontSize: 9,
    letterSpacing: 0.5,
    fontWeight: "700",
  },
  summaryValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 4,
  },
  summaryValueSm: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginTop: 4,
  },
  search: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  arrangeBtn: {
    alignSelf: "flex-start",
    marginBottom: spacing.sm,
    paddingVertical: 6,
  },
  controls: { marginBottom: spacing.md },
  eliteTitle: {
    color: colors.text,
    fontSize: 22,
    ...typography.heading,
    flexShrink: 1,
  },
  eliteSub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 4 },
  eliteSummaryLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    letterSpacing: 0.3,
    fontWeight: "600",
  },
  eliteSummaryValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
    marginTop: 6,
  },
  controlLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tabRow: { flexDirection: "row", gap: 6, paddingBottom: spacing.sm },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
  },
  chipOn: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  chipTextOn: { color: colors.cyan },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  section: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  manageLink: { color: colors.cyan, fontSize: 12, fontWeight: "700" },
  manageBox: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    padding: spacing.sm,
    marginBottom: spacing.md,
    gap: 4,
  },
  manageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  manageName: { color: colors.text, fontSize: 13, fontWeight: "600" },
  manageMeta: { color: colors.textTertiary, fontSize: 11, marginTop: 1 },
  emptyBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 36,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    lineHeight: 18,
  },
  emptyCreate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.cyan + "66",
  },
  emptyCreateText: { color: colors.cyan, fontSize: 13, fontWeight: "700" },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Grouped ("All" tab) layout — vaults grouped by type with section headers.
  groupedWrap: { gap: spacing.md },
  groupSection: { gap: spacing.sm },
  groupHeader: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  card: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.sm + 2,
    ...tileShadow(),
  },
  cardSm: { width: "31%" },
  cardMd: { width: "48%" },
  cardLg: { width: "100%" },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  cardKind: { color: colors.textTertiary, fontSize: 10, fontWeight: "700", flex: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  cardRole: {
    color: colors.gold,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  cardName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  cardNameSm: { fontSize: 12 },
  cardBalance: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
  },
  cardBalanceLg: { fontSize: 22 },
  cardBalanceSm: { fontSize: 13 },
  cardTime: { color: colors.textTertiary, fontSize: 11, marginTop: 4 },
  // Embedded mode — used by the wallet home collapsible tier sections.
  // No screen chrome (header bar / SafeAreaView / outer ScrollView); the
  // content flows directly inside the owning page's ScrollView.
  embeddedWrap: {
    alignSelf: "stretch",
  },
  embeddedBody: {
    paddingBottom: spacing.xs,
  },
});