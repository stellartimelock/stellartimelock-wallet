// Elite Dashboard — polished full-screen vault monitor for the Elite tier.
//
// Design: STL space theme. Deep-navy background, cyan-to-blue accent, OS-style
// dashboard cards at three sizes (full-width / half / third). Clear hierarchy:
// hero balance → stat row → vault type tabs → vault grid.
// No new features — visual/UX redesign of the institutional variant only.

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

import { type Vault } from "@/src/api/client";
import { useSession } from "@/src/state/session";
import {
  getCurrentTier,
  hasTierAccess,
  hydrateTier,
  isVaultTypeComingSoon,
  TIER_DASHBOARD_TABS,
  toTierVaultType,
  VAULT_TYPE_LABELS,
  type TierId,
  type TierVaultType,
} from "@/src/tiers/tier-config";
import { useToast } from "@/src/components/Toast";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { formatDaysRemaining } from "@/src/vault/countdown";
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
import {
  useVaultSessionData,
  type MultiSigSessionRow,
} from "@/src/vault/useVaultSessionData";
import {
  type MonitorPosition,
} from "@/src/vault/TierMonitorDashboard";

type EliteTab = TierVaultType | "All";

const ACCENT = "#4DB8E8"; // Elite cyan-blue
const ACCENT_MUTED = "rgba(77, 184, 232, 0.12)";
const ACCENT_BORDER = "rgba(77, 184, 232, 0.28)";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type VaultStatus = "locked" | "unlocked" | "withdrawn";

function statusOfStandard(v: Vault): VaultStatus {
  if (v.status === "withdrawn" || v.status === "archived") return "withdrawn";
  if (v.status === "unlocked") return "unlocked";
  return "locked";
}

function statusOfBeta(v: BetaVaultRecord, nowSec: number): VaultStatus {
  if (v.withdrawn) return "withdrawn";
  if (v.unlockTimestamp <= nowSec) return "unlocked";
  return "locked";
}

function statusOfAdvanced(v: AdvancedVaultRecord, nowSec: number): VaultStatus {
  if (v.kind === "HTLC")
    return htlcLifecycleToUnifiedStatus(deriveHtlcStatusFromAdvancedVault(v, nowSec));
  if (v.withdrawn || v.claimedByBackup) return "withdrawn";
  if (v.unlockTimestamp > 0 && v.unlockTimestamp <= nowSec) return "unlocked";
  if (
    (v.kind === "Vesting" || v.kind === "MultiAssetVesting") &&
    v.vestingEndTimestamp > 0 &&
    v.vestingEndTimestamp <= nowSec
  )
    return "unlocked";
  if (
    v.kind === "DeadManSwitch" &&
    v.lastPingTimestamp + v.inactivityPeriodSeconds <= nowSec
  )
    return "unlocked";
  return "locked";
}

function kindLabel(source: "standard" | "multi" | "advanced", advKind?: string): string {
  if (source === "standard" || advKind === "TimeLock") return "Time-Lock";
  if (source === "multi") return "Multi-asset";
  if (advKind === "CoolingOff") return "Cooling-off";
  if (advKind === "Vesting") return "Vesting";
  if (advKind === "MultiAssetVesting") return "M.A. Vesting";
  if (advKind === "DeadManSwitch") return "Dead Man's";
  if (advKind === "MultiSig") return "Multi-sig";
  if (advKind === "HTLC") return "HTLC";
  return advKind ?? "Vault";
}

function buildPositions(
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
      kindLabel: kindLabel("standard"),
      vaultType: "TimeLock",
      balance,
      balanceLabel: formatXlm(balance),
      status,
      unlockTimestamp: v.unlock_timestamp,
      timeLabel: status === "withdrawn" ? "Closed" : formatDaysRemaining(v.unlock_timestamp),
    });
  }

  for (const v of beta) {
    const status = statusOfBeta(v, nowSec);
    const symbol = tokenSymbolForAddress(v.tokenContractId) ?? "TOKEN";
    const amountFloat = Number(v.balance) / 10_000_000;
    out.push({
      id: `multi:${v.vaultId.toString()}`,
      name: v.name?.trim() || `Vault #${v.vaultId.toString()}`,
      kindLabel: kindLabel("multi"),
      vaultType: "MultiAsset",
      balance: amountFloat,
      balanceLabel: `${amountFloat.toFixed(2)} ${symbol}`,
      status,
      unlockTimestamp: v.unlockTimestamp,
      timeLabel: status === "withdrawn" ? "Closed" : formatDaysRemaining(v.unlockTimestamp),
    });
  }

  for (const v of advanced) {
    const status = statusOfAdvanced(v, nowSec);
    const bal = stroopsToFloat(v.balance);
    const vaultType = toTierVaultType("advanced", v.kind);
    out.push({
      id: `advanced:${v.kind}:${v.vaultId.toString()}`,
      name: v.name?.trim() || `Adv #${v.vaultId.toString()}`,
      kindLabel: kindLabel("advanced", v.kind),
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

  for (const row of multiSig) {
    const completed = row.balanceXlm <= 0 && !row.pendingApproval;
    out.push({
      id: `msig:${row.entry.contractId}`,
      name: "Multi-Sig Vault",
      kindLabel: kindLabel("advanced", "MultiSig"),
      vaultType: "MultiSig",
      balance: row.balanceXlm,
      balanceLabel: formatXlm(row.balanceXlm),
      status: completed ? "withdrawn" : "locked",
      unlockTimestamp: row.unlockTimestamp,
      timeLabel: completed
        ? "Completed"
        : row.pendingApproval
          ? "Awaiting co-signer"
          : row.unlockTimestamp > 0
            ? formatDaysRemaining(row.unlockTimestamp)
            : "Multi-Sig",
      roleLabel: completed ? "COMPLETED" : row.pendingApproval ? "PENDING" : "ACTIVE",
      multiSigContractId: row.entry.contractId,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Status dot color
// ---------------------------------------------------------------------------

function dotColor(p: MonitorPosition): string {
  if (p.roleLabel === "PENDING" || p.roleLabel === "PENDING APPROVAL") return colors.gold;
  if (p.roleLabel === "COMPLETED") return colors.statusClosed;
  if (p.status === "unlocked") return "#30D158"; // iOS green
  if (p.status === "locked") return ACCENT;
  return colors.statusClosed;
}

// ---------------------------------------------------------------------------
// Vault card component
// ---------------------------------------------------------------------------

type CardSize = "full" | "half" | "third";

function VaultCard({
  position,
  size,
  onPress,
  testID,
}: {
  position: MonitorPosition;
  size: CardSize;
  onPress?: () => void;
  testID?: string;
}) {
  const dot = dotColor(position);
  const body = (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardKind} numberOfLines={1}>
          {position.kindLabel.toUpperCase()}
        </Text>
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </View>
      {position.roleLabel ? (
        <Text style={[styles.cardRole, { color: dot }]} numberOfLines={1}>
          {position.roleLabel}
        </Text>
      ) : null}
      <Text
        style={[styles.cardName, size === "third" ? { fontSize: 12 } : null]}
        numberOfLines={2}
      >
        {position.name}
      </Text>
      <Text
        style={[
          styles.cardBalance,
          size === "full" ? styles.cardBalanceFull : size === "third" ? styles.cardBalanceThird : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {position.balanceLabel}
      </Text>
      <Text style={styles.cardTime} numberOfLines={1}>
        {position.timeLabel}
      </Text>
    </View>
  );

  const cardStyle = [
    styles.cardWrap,
    size === "full"
      ? styles.cardFull
      : size === "third"
        ? styles.cardThird
        : styles.cardHalf,
  ];

  if (onPress) {
    return (
      <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.82} testID={testID}>
        {body}
      </TouchableOpacity>
    );
  }
  return <View style={cardStyle} testID={testID}>{body}</View>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EliteDashboard() {
  const router = useRouter();
  const toast = useToast();
  const { wallet, formatXlm } = useSession();

  const {
    standard,
    beta,
    advanced,
    multiSig,
    loading: vaultsLoading,
    refreshing,
    error: vaultsError,
    refresh: refreshVaults,
  } = useVaultSessionData();

  const [userTier, setUserTier] = useState<TierId>(getCurrentTier());
  const [tab, setTab] = useState<EliteTab>("All");
  const [query, setQuery] = useState("");
  const [showArrange, setShowArrange] = useState(false);

  useEffect(() => {
    void hydrateTier().then(setUserTier);
  }, []);

  const hasAccess = hasTierAccess("elite", userTier);
  const tabs = TIER_DASHBOARD_TABS["elite"];

  const positions = useMemo(
    () => buildPositions(standard ?? [], beta, advanced, multiSig, formatXlm),
    [standard, beta, advanced, multiSig, formatXlm],
  );

  const loading = vaultsLoading && standard == null;

  const tabPositions = useMemo(() => {
    if (tab === "All") return positions.filter((p) => tabs.some((t) => t.key === p.vaultType));
    return positions.filter((p) => p.vaultType === tab);
  }, [positions, tab, tabs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = tabPositions.filter((p) => p.status !== "withdrawn");
    if (q) {
      rows = rows.filter(
        (p) => p.name.toLowerCase().includes(q) || p.kindLabel.toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => b.balance - a.balance);
  }, [tabPositions, query]);

  const totals = useMemo(() => {
    const active = positions.filter((p) => p.status !== "withdrawn");
    const sum = active.reduce((acc, p) => acc + p.balance, 0);
    const locked = active.filter((p) => p.status === "locked").length;
    const ready = active.filter((p) => p.status === "unlocked").length;
    return { sum, locked, ready, count: active.length };
  }, [positions]);

  const openCreate = useCallback(
    (type?: TierVaultType) => {
      if (!hasAccess) return;
      const t = type ?? tabs[0]?.key ?? "TimeLock";
      if (isVaultTypeComingSoon(t)) {
        toast.show("This vault type is coming soon.", "info");
        return;
      }
      if (t === "HTLC") {
        router.push({ pathname: "/create-vault", params: { tab: "advanced", type: "HTLC" } } as never);
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
      router.push({ pathname: "/create-vault", params: { tab: "advanced", type: t } } as never);
    },
    [hasAccess, router, tabs, toast],
  );

  const cardSizeFor = useCallback(
    (p: MonitorPosition, idx: number): CardSize => {
      if (idx === 0 || p.balance >= totals.sum * 0.35) return "full";
      if (p.balance >= totals.sum * 0.1) return "half";
      return "third";
    },
    [totals.sum],
  );

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="elite-tier-screen">
      {/* Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet"))}
          style={styles.headerBack}
          hitSlop={12}
          testID="elite-tier-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Elite Dashboard
            </Text>
            <View style={styles.eliteBadge} testID="elite-tier-badge">
              <Feather name="star" size={9} color={ACCENT} />
              <Text style={styles.eliteBadgeText}>ELITE</Text>
            </View>
          </View>
          <Text style={styles.headerSub}>Every vault type · no limits</Text>
        </View>
        {hasAccess ? (
          <TouchableOpacity
            onPress={() => openCreate()}
            style={styles.newVaultBtn}
            testID="elite-new-vault"
          >
            <Feather name="plus" size={13} color={ACCENT} />
            <Text style={styles.newVaultText}>New Vault</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshVaults()}
            tintColor={ACCENT}
          />
        }
      >
        {!hasAccess ? (
          <View style={styles.upgradeCard} testID="elite-upgrade-prompt">
            <Feather name="lock" size={18} color={colors.gold} />
            <Text style={styles.upgradeTitle}>Elite tier required</Text>
            <Text style={styles.upgradeBody}>
              Upgrade to Elite ($75/mo) for unlimited vaults, Dead Man's Switch, HTLC, and every
              other vault type.
            </Text>
            <TouchableOpacity
              style={styles.upgradeCta}
              onPress={() => router.push("/settings" as never)}
            >
              <Text style={styles.upgradeCtaText}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Hero — total watched balance */}
        {hasAccess ? (
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>TOTAL ACTIVE BALANCE</Text>
            <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {formatXlm(totals.sum)}
            </Text>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <View style={[styles.heroStatDot, { backgroundColor: ACCENT }]} />
                <Text style={styles.heroStatLabel}>LOCKED</Text>
                <Text style={styles.heroStatValue}>{totals.locked}</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <View style={[styles.heroStatDot, { backgroundColor: "#30D158" }]} />
                <Text style={styles.heroStatLabel}>READY</Text>
                <Text style={styles.heroStatValue}>{totals.ready}</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStat}>
                <View style={[styles.heroStatDot, { backgroundColor: colors.textTertiary }]} />
                <Text style={styles.heroStatLabel}>TOTAL</Text>
                <Text style={styles.heroStatValue}>{totals.count}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Vault type tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
          testID="elite-kind-tabs"
        >
          <EliteTab
            label="All"
            active={tab === "All"}
            onPress={() => setTab("All")}
            testID="elite-tab-All"
          />
          {tabs.map((t) => (
            <EliteTab
              key={t.key}
              label={t.label}
              active={tab === t.key}
              onPress={() => setTab(t.key)}
              testID={`elite-tab-${t.key}`}
            />
          ))}
        </ScrollView>

        {/* Search + Arrange */}
        {hasAccess ? (
          <>
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <Feather name="search" size={13} color={colors.textTertiary} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Find a vault…"
                  placeholderTextColor={colors.textTertiary}
                  testID="elite-tier-search"
                />
                {query.length > 0 ? (
                  <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
                    <Feather name="x" size={13} color={colors.textTertiary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity
                onPress={() => setShowArrange((v) => !v)}
                style={styles.arrangeBtn}
                testID="elite-arrange-toggle"
              >
                <Feather name="sliders" size={14} color={showArrange ? ACCENT : colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {showArrange ? (
              <View style={styles.arrangePanel} testID="elite-arrange-panel">
                <Text style={styles.arrangePanelTitle}>VAULT TYPES IN THIS VIEW</Text>
                <View style={styles.arrangePanelRow}>
                  {tabs.map((t) => (
                    <TouchableOpacity
                      key={t.key}
                      onPress={() => openCreate(t.key)}
                      style={styles.arrangePill}
                      testID={`elite-create-${t.key}`}
                    >
                      <Feather name="plus" size={10} color={ACCENT} />
                      <Text style={styles.arrangePillText}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        {/* Vault grid */}
        {loading ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 32 }} />
        ) : vaultsError ? (
          <View style={styles.emptyBox}>
            <Feather name="alert-circle" size={22} color={colors.danger} />
            <Text style={styles.emptyText}>{vaultsError}</Text>
          </View>
        ) : !wallet ? (
          <View style={styles.emptyBox}>
            <Feather name="link" size={22} color={colors.textTertiary} />
            <Text style={styles.emptyText}>Connect a wallet to view vaults.</Text>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.emptyBox}>
            <Feather name="inbox" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No active vaults</Text>
            <Text style={styles.emptyText}>
              {tab === "All"
                ? "Create your first vault to start tracking it here."
                : `No ${VAULT_TYPE_LABELS[tab as TierVaultType] ?? tab} vaults yet.`}
            </Text>
            <TouchableOpacity
              style={styles.createCta}
              onPress={() => openCreate(tab !== "All" ? (tab as TierVaultType) : undefined)}
              testID="elite-empty-create"
            >
              <Feather name="plus" size={14} color={ACCENT} />
              <Text style={styles.createCtaText}>New Vault</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.grid} testID="elite-vault-grid">
            {visible.map((p, idx) => (
              <VaultCard
                key={p.id}
                position={p}
                size={cardSizeFor(p, idx)}
                testID={`elite-position-${p.id}`}
                onPress={
                  p.multiSigContractId
                    ? () => router.push(`/multi-sig/${p.multiSigContractId}` as never)
                    : p.htlcVaultId
                      ? () => router.push(`/htlc/${p.htlcVaultId}` as never)
                      : undefined
                }
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Tab chip
// ---------------------------------------------------------------------------

function EliteTab({
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
      style={[styles.tab, active && styles.tabOn]}
      testID={testID}
      activeOpacity={0.75}
    >
      <Text style={[styles.tabText, active && styles.tabTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: ACCENT_BORDER,
    borderBottomWidth: 1,
    gap: spacing.sm,
    backgroundColor: "rgba(10,14,23,0.97)",
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  eliteBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: ACCENT_MUTED,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  eliteBadgeText: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  headerSub: {
    color: colors.textTertiary,
    fontSize: 11,
    marginTop: 1,
  },
  newVaultBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    backgroundColor: ACCENT_MUTED,
  },
  newVaultText: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: "700",
  },

  body: {
    padding: spacing.md,
    paddingBottom: 48,
    gap: spacing.md,
  },

  upgradeCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.gold + "44",
    backgroundColor: colors.gold + "10",
    padding: spacing.md,
    gap: 8,
    ...tileShadow(),
  },
  upgradeTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  upgradeBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  upgradeCta: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.gold,
  },
  upgradeCtaText: { color: colors.textInverse, fontSize: 13, fontWeight: "700" },

  heroCard: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg,
    padding: spacing.md + 4,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    ...tileShadow(),
  },
  heroLabel: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  heroValue: {
    color: colors.text,
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: spacing.md,
  },
  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    backgroundColor: colors.background,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
  },
  heroStat: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    gap: 2,
  },
  heroStatDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginBottom: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.borderSubtle,
  },
  heroStatLabel: {
    color: colors.textTertiary,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  heroStatValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },

  tabRow: {
    flexDirection: "row",
    gap: 6,
    paddingBottom: 2,
  },
  tab: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
  },
  tabOn: {
    borderColor: ACCENT_BORDER,
    backgroundColor: ACCENT_MUTED,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  tabTextOn: {
    color: ACCENT,
  },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    padding: 0,
  },
  arrangeBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  arrangePanel: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    gap: 8,
  },
  arrangePanelTitle: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  arrangePanelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  arrangePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: ACCENT_MUTED,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  arrangePillText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "600",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cardWrap: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  cardFull: { width: "100%" },
  cardHalf: { width: "47.5%" },
  cardThird: { width: "30.5%" },
  card: {
    padding: spacing.sm + 2,
    gap: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  cardKind: {
    color: colors.textTertiary,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.4,
    flex: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  cardRole: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  cardName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
  },
  cardBalance: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },
  cardBalanceFull: { fontSize: 22 },
  cardBalanceThird: { fontSize: 13 },
  cardTime: {
    color: colors.textTertiary,
    fontSize: 10,
    marginTop: 2,
  },

  emptyBox: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 44,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
  },
  createCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
    backgroundColor: ACCENT_MUTED,
  },
  createCtaText: { color: ACCENT, fontSize: 13, fontWeight: "700" },
});
