import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Card } from "@/src/components/Card";
import { useSession } from "@/src/state/session";
import { useDiscoveredVaults } from "@/src/state/discovered-vaults";
import {
  getCurrentTier,
  hasTierAccess,
  hydrateTier,
  type TierId,
} from "@/src/tiers/tier-config";
import { colors, radii, spacing, tileShadow, typography, accentGlow } from "@/src/theme";
import { formatDaysRemaining } from "@/src/vault/countdown";
import { useVaultSessionData } from "@/src/vault/useVaultSessionData";
import {
  ADVANCED_VAULT_KIND_META,
  deriveHtlcStatusFromAdvancedVault,
  htlcLifecycleToUnifiedStatus,
  stroopsToFloat,
  type AdvancedVaultRecord,
} from "@/src/wallet/advanced-vaults";
import {
  isNativeXlmAddress,
  tokenSymbolForAddress,
  type BetaVaultRecord,
} from "@/src/wallet/multi-asset-beta";
import type { Vault } from "@/src/api/client";

type VaultListKind = "standard" | "multi-asset" | "advanced";

type UnifiedStatus = "locked" | "unlocked" | "withdrawn";

interface UnifiedVaultItem {
  key: string;
  kind: VaultListKind;
  id: string;
  name: string;
  typeLabel: string;
  typeColor: string;
  amountLabel: string;
  /** Native XLM amount for USD conversion. Omitted for non-XLM multi-asset rows. */
  amountXlm?: number;
  status: UnifiedStatus;
  timeLabel: string;
  unlockTimestamp: number;
  /** 0–1 lock/vesting/cooling-off elapsed; null when the period is unknown. */
  progress: number | null;
  /** Multi-party role badge, e.g. BENEFICIARY OF / PENDING APPROVAL */
  roleLabel?: string;
  isNew?: boolean;
  /** Multi-Sig rows navigate to the management screen. */
  route?: "multi-sig" | "htlc";
}

const KIND_META: Record<
  VaultListKind,
  { label: string; color: string }
> = {
  standard: { label: "Standard", color: colors.teal },
  "multi-asset": { label: "Multi-Asset", color: colors.gold },
  advanced: { label: "Advanced", color: colors.cyan },
};

function advancedTypeMeta(v: AdvancedVaultRecord): { label: string; color: string } {
  if (v.kind === "TimeLock") {
    return { label: "Standard", color: colors.teal };
  }
  const meta = ADVANCED_VAULT_KIND_META[v.kind];
  return {
    label: meta?.label ?? v.kind,
    color: meta?.accent ?? KIND_META.advanced.color,
  };
}

function statusOfStandard(v: Vault): UnifiedStatus {
  if (v.status === "withdrawn" || v.status === "archived") return "withdrawn";
  if (v.status === "unlocked") return "unlocked";
  return "locked";
}

function statusOfBeta(v: BetaVaultRecord, nowSec: number): UnifiedStatus {
  if (v.withdrawn) return "withdrawn";
  if (v.unlockTimestamp <= nowSec) return "unlocked";
  return "locked";
}

function statusOfAdvanced(v: AdvancedVaultRecord, nowSec: number): UnifiedStatus {
  if (v.kind === "HTLC") {
    return htlcLifecycleToUnifiedStatus(deriveHtlcStatusFromAdvancedVault(v, nowSec));
  }
  if (v.withdrawn || v.claimedByBackup) return "withdrawn";
  if (v.unlockTimestamp > 0 && v.unlockTimestamp <= nowSec) return "unlocked";
  if (v.kind === "Vesting" && v.vestingEndTimestamp > 0 && v.vestingEndTimestamp <= nowSec) {
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

function timeLabelFor(status: UnifiedStatus, unlockTimestamp: number): string {
  if (status === "withdrawn") return "Withdrawn";
  if (status === "unlocked" || unlockTimestamp <= 0) {
    return formatDaysRemaining(unlockTimestamp);
  }
  return formatDaysRemaining(unlockTimestamp);
}

function advancedTimeLabel(v: AdvancedVaultRecord, status: UnifiedStatus, nowSec: number): string {
  if (v.kind === "HTLC") {
    const life = deriveHtlcStatusFromAdvancedVault(v, nowSec);
    if (life === "locked") return "HTLC locked";
    if (life === "claimable") return "Claimable";
    if (life === "expired") return "Expired — refundable";
    if (life === "claimed") return "Claimed";
    if (life === "refunded") return "Refunded";
  }
  if (status === "withdrawn") return "Withdrawn";
  if (v.kind === "DeadManSwitch") {
    const deadline = v.lastPingTimestamp + v.inactivityPeriodSeconds;
    const left = deadline - nowSec;
    if (left <= 0) return "Claimable";
    return formatDaysRemaining(deadline);
  }
  if (v.kind === "Vesting") {
    if (v.vestingEndTimestamp > 0) return formatDaysRemaining(v.vestingEndTimestamp);
    return status === "unlocked" ? "Ready to withdraw" : "Vesting Schedule";
  }
  if (v.kind === "CoolingOff") {
    if (v.withdrawalInitiatedTimestamp > 0) {
      const readyAt = v.withdrawalInitiatedTimestamp + v.coolingOffDurationSeconds;
      return formatDaysRemaining(readyAt);
    }
    return "Cooling-Off";
  }
  return timeLabelFor(status, v.unlockTimestamp);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Elapsed fraction of [start, end]. Null when the window cannot be measured. */
function elapsedProgress(start: number, end: number, nowSec: number): number | null {
  if (!(start > 0) || !(end > start)) return null;
  return clamp01((nowSec - start) / (end - start));
}

function advancedProgress(v: AdvancedVaultRecord, nowSec: number): number | null {
  if (v.kind === "Vesting" || v.kind === "MultiAssetVesting") {
    return elapsedProgress(v.vestingStartTimestamp, v.vestingEndTimestamp, nowSec);
  }
  if (v.kind === "CoolingOff") {
    if (!(v.coolingOffDurationSeconds > 0)) return null;
    if (!(v.withdrawalInitiatedTimestamp > 0)) return 0;
    return elapsedProgress(
      v.withdrawalInitiatedTimestamp,
      v.withdrawalInitiatedTimestamp + v.coolingOffDurationSeconds,
      nowSec,
    );
  }
  if (v.kind === "TimeLock" || v.kind === "HTLC") {
    return elapsedProgress(v.createdTimestamp, v.unlockTimestamp, nowSec);
  }
  return null;
}

function formatUsdFromXlm(xlm: number, usdRate: number): string | null {
  if (!(usdRate > 0) || !Number.isFinite(xlm)) return null;
  const v = xlm * usdRate;
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function UnifiedVaultsList({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { formatXlm, browseMode, wallet } = useSession();
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(id);
  }, []);
  const {
    vaults: discovered,
    newCount,
    scan: scanMemos,
    markSeen,
  } = useDiscoveredVaults(wallet?.publicKey);
  const {
    standard,
    beta,
    advanced,
    multiSig,
    loading,
    error,
  } = useVaultSessionData();
  const [listMode, setListMode] = useState<VaultListKind>("standard");
  const [tierId, setTierId] = useState<TierId>(getCurrentTier());

  useFocusEffect(
    useCallback(() => {
      void hydrateTier().then(setTierId);
    }, []),
  );

  // Multi-Asset is Pro and up — Plus / Free-with-advanced get Vaults | Advanced.
  const showMultiAssetTab = hasTierAccess("pro", tierId);

  // Memo discovery is independent of the vault session cache.
  useEffect(() => {
    if (!wallet) return;
    void scanMemos().catch(() => []);
  }, [wallet?.publicKey, scanMemos, wallet]);

  const items = useMemo<UnifiedVaultItem[]>(() => {
    const out: UnifiedVaultItem[] = [];

    for (const v of standard ?? []) {
      const balance = Number.isFinite(v.balance) ? v.balance : 0;
      const status = statusOfStandard(v);
      if (status !== "withdrawn" && balance <= 0) continue;
      out.push({
        key: `standard-${v.vault_id}`,
        kind: "standard",
        id: v.vault_id,
        name: v.name?.trim() || `Vault ${v.vault_id.slice(0, 8)}…`,
        typeLabel: KIND_META.standard.label,
        typeColor: KIND_META.standard.color,
        amountLabel: formatXlm(balance),
        amountXlm: balance,
        status,
        timeLabel: timeLabelFor(status, v.unlock_timestamp),
        unlockTimestamp: v.unlock_timestamp,
        progress: elapsedProgress(v.created_timestamp, v.unlock_timestamp, nowSec),
      });
    }

    for (const v of beta) {
      const status = statusOfBeta(v, nowSec);
      const symbol = tokenSymbolForAddress(v.tokenContractId) ?? "TOKEN";
      const amountFloat = Number(v.balance) / 10_000_000;
      const isXlm = isNativeXlmAddress(v.tokenContractId);
      out.push({
        key: `multi-${v.vaultId.toString()}`,
        kind: "multi-asset",
        id: v.vaultId.toString(),
        name: v.name?.trim() || `Vault #${v.vaultId.toString()}`,
        typeLabel: KIND_META["multi-asset"].label,
        typeColor: KIND_META["multi-asset"].color,
        amountLabel: `${amountFloat.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })} ${symbol}`,
        amountXlm: isXlm ? amountFloat : undefined,
        status,
        timeLabel: timeLabelFor(status, v.unlockTimestamp),
        unlockTimestamp: v.unlockTimestamp,
        progress: elapsedProgress(v.createdTimestamp, v.unlockTimestamp, nowSec),
      });
    }

    // Track advanced vault ids already rendered so memo-discovered DMS
    // rows don't duplicate listAdvancedVaults beneficiary merges.
    const seenDmsIds = new Set<string>();
    for (const v of advanced) {
      const status = statusOfAdvanced(v, nowSec);
      const amountFloat = stroopsToFloat(v.balance);
      const typeMeta = advancedTypeMeta(v);
      const discoveredMatch = discovered.find(
        (d) =>
          d.kind === "DeadManSwitch" && d.ref === v.vaultId.toString(),
      );
      if (v.kind === "DeadManSwitch") {
        seenDmsIds.add(v.vaultId.toString());
      }
      out.push({
        key: `advanced-${v.kind}-${v.vaultId.toString()}`,
        kind: "advanced",
        id: v.vaultId.toString(),
        name: v.name?.trim() || `Vault #${v.vaultId.toString()}`,
        typeLabel: typeMeta.label,
        typeColor: typeMeta.color,
        amountLabel: `${amountFloat.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })} XLM`,
        amountXlm:
          v.kind === "MultiAssetVesting" && !isNativeXlmAddress(v.token)
            ? undefined
            : amountFloat,
        status,
        timeLabel: advancedTimeLabel(v, status, nowSec),
        unlockTimestamp: v.unlockTimestamp,
        progress: advancedProgress(v, nowSec),
        roleLabel:
          v.kind === "HTLC"
            ? v.isBeneficiary
              ? "RECIPIENT"
              : "SENDER"
            : v.isBeneficiary
              ? "BENEFICIARY OF"
              : undefined,
        isNew: discoveredMatch?.isNew,
        route: v.kind === "HTLC" ? "htlc" : undefined,
      });
    }

    // Multi-Sig (per-contract) — owned + memo-discovered co-signer vaults.
    const seenContracts = new Set<string>();
    for (const row of multiSig) {
      seenContracts.add(row.entry.contractId);
      const meta = ADVANCED_VAULT_KIND_META.MultiSig;
      const completed =
        row.balanceXlm <= 0 && !row.pendingApproval;
      out.push({
        key: `msig-${row.entry.contractId}`,
        kind: "advanced",
        id: row.entry.contractId,
        name: "Multi-Sig Vault",
        typeLabel: meta.label,
        typeColor: meta.accent,
        amountLabel: `${row.balanceXlm.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })} XLM`,
        amountXlm: row.balanceXlm,
        // Completed → withdrawn so active list filters them out.
        status: completed ? "withdrawn" : "locked",
        timeLabel: completed
          ? "Completed"
          : row.pendingApproval
            ? "Awaiting co-signer"
            : row.unlockTimestamp > 0
              ? formatDaysRemaining(row.unlockTimestamp)
              : "Multi-Sig",
        unlockTimestamp: row.unlockTimestamp,
        progress: null,
        roleLabel: completed
          ? "COMPLETED"
          : row.pendingApproval
            ? "PENDING APPROVAL"
            : "ACTIVE",
        isNew: !!row.entry.isNew,
        route: "multi-sig",
      });
    }
    for (const d of discovered) {
      if (d.kind !== "MultiSig" || seenContracts.has(d.ref)) continue;
      const meta = ADVANCED_VAULT_KIND_META.MultiSig;
      const completed = d.balanceXlm <= 0 && !d.pendingApproval;
      out.push({
        key: d.key,
        kind: "advanced",
        id: d.ref,
        name: d.name,
        typeLabel: meta.label,
        typeColor: meta.accent,
        amountLabel: `${d.balanceXlm.toLocaleString(undefined, {
          maximumFractionDigits: 4,
        })} XLM`,
        amountXlm: d.balanceXlm,
        status: completed ? "withdrawn" : "locked",
        timeLabel: completed
          ? "Completed"
          : d.pendingApproval
            ? "Awaiting co-signer"
            : "Multi-Sig",
        unlockTimestamp: 0,
        progress: null,
        roleLabel: completed
          ? "COMPLETED"
          : d.pendingApproval
            ? "PENDING APPROVAL"
            : "ACTIVE",
        isNew: d.isNew,
        route: "multi-sig",
      });
    }

    // Dead Man's Switch — memo-discovered beneficiaries not already in `advanced`.
    for (const d of discovered) {
      if (d.kind !== "DeadManSwitch" || seenDmsIds.has(d.ref)) continue;
      const meta = ADVANCED_VAULT_KIND_META.DeadManSwitch;
      const v = d.advanced;
      if (v) {
        const status = statusOfAdvanced(v, nowSec);
        const amountFloat = stroopsToFloat(v.balance);
        out.push({
          key: d.key,
          kind: "advanced",
          id: d.ref,
          name: d.name?.trim() || v.name?.trim() || `Vault #${d.ref}`,
          typeLabel: meta.label,
          typeColor: meta.accent,
          amountLabel: `${amountFloat.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })} XLM`,
          amountXlm: amountFloat,
          status,
          timeLabel: advancedTimeLabel(v, status, nowSec),
          unlockTimestamp: v.unlockTimestamp,
          progress: advancedProgress(v, nowSec),
          roleLabel: "BENEFICIARY OF",
          isNew: d.isNew,
        });
      } else {
        out.push({
          key: d.key,
          kind: "advanced",
          id: d.ref,
          name: d.name?.trim() || `Dead Man's Switch #${d.ref}`,
          typeLabel: meta.label,
          typeColor: meta.accent,
          amountLabel: `${d.balanceXlm.toLocaleString(undefined, {
            maximumFractionDigits: 4,
          })} XLM`,
          amountXlm: d.balanceXlm,
          status: d.balanceXlm <= 0 ? "withdrawn" : "locked",
          timeLabel: d.balanceXlm <= 0 ? "Withdrawn" : "Dead Man's Switch",
          unlockTimestamp: 0,
          progress: null,
          roleLabel: "BENEFICIARY OF",
          isNew: d.isNew,
        });
      }
    }

    const rank = (s: UnifiedStatus) =>
      s === "locked" ? 0 : s === "unlocked" ? 1 : 2;
    out.sort((a, b) => {
      if (a.isNew && !b.isNew) return -1;
      if (!a.isNew && b.isNew) return 1;
      const rd = rank(a.status) - rank(b.status);
      if (rd !== 0) return rd;
      return a.unlockTimestamp - b.unlockTimestamp;
    });
    return out;
  }, [standard, beta, advanced, multiSig, discovered, formatXlm, nowSec]);

  // Plus+ always get the mode toggle. Free only when they have advanced
  // content (e.g. DMS beneficiary / Multi-Sig co-signer discovery).
  const hasAdvancedVaults =
    advanced.length > 0 ||
    multiSig.length > 0 ||
    discovered.some(
      (d) => d.kind === "DeadManSwitch" || d.kind === "MultiSig",
    );
  const showModeToggle = tierId !== "free" || hasAdvancedVaults;

  // Keep the active tab valid when the set of available tabs shrinks
  // (e.g. Plus users lose the Multi-Asset tab, Free loses Advanced).
  useEffect(() => {
    if (listMode !== "standard" && !showModeToggle) {
      setListMode("standard");
      return;
    }
    if (listMode === "multi-asset" && !showMultiAssetTab) {
      setListMode("standard");
    }
  }, [listMode, showModeToggle, showMultiAssetTab]);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (i) =>
          i.kind === listMode &&
          (i.status === "locked" || i.status === "unlocked"),
      ),
    [items, listMode],
  );
  const activeCount = useMemo(
    () =>
      items.filter((i) => i.status === "locked" || i.status === "unlocked")
        .length,
    [items],
  );

  const onPressRow = useCallback(
    (item: UnifiedVaultItem) => {
      if (item.isNew) {
        void markSeen(
          item.route === "multi-sig"
            ? `msig:${item.id}`
            : `dms:${item.id}`,
        );
      }
      if (item.route === "multi-sig") {
        router.push(`/multi-sig/${item.id}`);
        return;
      }
      if (item.route === "htlc") {
        router.push(`/htlc/${item.id}`);
        return;
      }
      if (item.kind === "standard") {
        router.push(`/vault/${item.id}`);
        return;
      }
      router.push({
        pathname: "/vault/[id]",
        params: { id: item.id, type: item.kind },
      });
    },
    [router, markSeen],
  );

  return (
    <View
      style={[styles.wrap, embedded && styles.wrapEmbedded]}
      testID="unified-vaults-list"
    >
      {showModeToggle ? (
        <View style={styles.modeToggle} testID="unified-vaults-mode-toggle">
          {(
            [
              { id: "standard" as const, label: "Vaults" },
              { id: "advanced" as const, label: "Advanced" },
              ...(showMultiAssetTab
                ? [{ id: "multi-asset" as const, label: "Multi-Asset" }]
                : []),
            ]
          ).map((seg) => {
            const on = listMode === seg.id;
            const showBadge = seg.id === "advanced" && newCount > 0;
            return (
              <TouchableOpacity
                key={seg.id}
                onPress={() => setListMode(seg.id)}
                style={[styles.modeBtn, on && styles.modeBtnActive]}
                testID={`unified-vaults-mode-${seg.id}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.modeBtnText, on && styles.modeBtnTextActive]}>
                  {seg.label}
                </Text>
                {showBadge ? (
                  <View style={styles.newBadge} testID="unified-vaults-new-badge">
                    <Text style={styles.newBadgeText}>{newCount}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={styles.freeTierEyebrow} testID="unified-vaults-free-active-label">
          ACTIVE VAULTS
        </Text>
      )}

      {!embedded ? (
        <View style={styles.headerBtnRow}>
          <TouchableOpacity
            onPress={() => router.push("/create-vault")}
            style={[
              styles.newBtnLarge,
              accentGlow("rgba(0, 229, 255, 0.45)"),
            ]}
            testID="crypto-vaults-new-button"
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Create a new vault"
          >
            <Feather name="plus" size={14} color={colors.cyan} />
            <Text style={styles.newBtnLargeText}>New Vault</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/vault/about")}
            style={[
              styles.aboutBtnLarge,
              accentGlow("rgba(0, 229, 255, 0.45)"),
            ]}
            testID="crypto-vaults-about-button"
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="What is a vault? Read the primitive explainer."
          >
            <Text style={styles.aboutBtnLargeText} numberOfLines={1}>
              What is a Vault?
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && standard == null && wallet ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.cyan} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorRow}>
          <Feather name="alert-circle" size={12} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!loading && !wallet ? (
        <View style={styles.emptyCard} testID="unified-vaults-no-wallet">
          <View style={styles.emptyIcon}>
            <Feather name="link" size={22} color={colors.teal} />
          </View>
          <Text style={styles.emptyTitle}>Connect a wallet to view vaults</Text>
          <Text style={styles.emptyBody}>
            You&apos;re browsing without a seed. Add or import a wallet to load
            your vaults and create new ones.
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/wallet-setup")}
            style={styles.connectBtn}
            testID="unified-vaults-connect-wallet"
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Connect a wallet"
          >
            <Text style={styles.connectBtnText}>
              {browseMode ? "Add seed phrase" : "Connect wallet"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {standard != null && wallet && activeCount === 0 && !error && !loading ? (
        <View style={styles.emptyCard} testID="unified-vaults-empty">
          <View style={styles.emptyIcon}>
            <Feather name="lock" size={22} color={colors.teal} />
          </View>
          <Text style={styles.emptyTitle}>No vaults yet</Text>
          <Text style={styles.emptyBody}>
            Lock XLM or any Stellar token until any date up to 1000 days out.
            Once created it can&apos;t be opened early — a hands-off savings
            primitive.
          </Text>
        </View>
      ) : null}

      {standard != null &&
      wallet &&
      activeCount > 0 &&
      visibleItems.length === 0 &&
      !error ? (
        <View style={styles.emptyCard} testID={`unified-vaults-empty-${listMode}`}>
          <Text style={styles.emptyTitle}>
            {listMode === "standard"
              ? "No active vaults"
              : listMode === "advanced"
                ? "No active advanced vaults"
                : "No active multi-asset vaults"}
          </Text>
          <Text style={styles.emptyBody}>
            {listMode === "standard"
              ? "Locked standard vaults will appear here."
              : listMode === "advanced"
                ? "Locked advanced vaults will appear here."
                : "Locked multi-asset vaults will appear here."}
          </Text>
        </View>
      ) : null}

      {standard != null
        ? visibleItems.map((item) => (
            <UnifiedVaultRow
              key={item.key}
              item={item}
              onPress={() => onPressRow(item)}
            />
          ))
        : null}
    </View>
  );
}

function UnifiedVaultRow({
  item,
  onPress,
}: {
  item: UnifiedVaultItem;
  onPress: () => void;
}) {
  const { rates } = useSession();
  const usdLabel =
    item.amountXlm != null ? formatUsdFromXlm(item.amountXlm, rates.USD) : null;
  const kindMeta = { label: item.typeLabel, color: item.typeColor };
  const isCompleted = item.roleLabel === "COMPLETED";
  const statusColor =
    isCompleted
      ? colors.statusClosed
      : item.status === "locked"
        ? colors.statusPending
        : item.status === "unlocked"
          ? colors.statusActive
          : colors.statusClosed;
  const statusIcon =
    isCompleted
      ? "check"
      : item.status === "locked"
        ? "lock"
        : item.status === "unlocked"
          ? "unlock"
          : "check";
  const statusPillText = isCompleted ? "completed" : item.status;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      testID={`unified-vault-row-${item.kind}-${item.id}`}
    >
      <Card status={item.status === "withdrawn" ? "archived" : item.status} padded>
        <View style={styles.rowTop}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <View style={styles.nameRow}>
              <Text style={styles.vaultName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.isNew ? (
                <View style={styles.dotNew} testID={`unified-vault-new-${item.id}`} />
              ) : null}
              <View
                style={[styles.typeBadge, { borderColor: kindMeta.color }]}
                testID={`unified-vault-type-${item.kind}-${item.id}`}
              >
                <Text style={[styles.typeBadgeText, { color: kindMeta.color }]}>
                  {kindMeta.label}
                </Text>
              </View>
            </View>
            {item.roleLabel ? (
              <Text
                style={styles.roleLabel}
                numberOfLines={1}
                testID={`unified-vault-role-${item.id}`}
              >
                {item.roleLabel}
              </Text>
            ) : null}
            <Text style={styles.vaultSub} numberOfLines={1}>
              {item.timeLabel}
            </Text>
          </View>
          <View
            style={[styles.statusPill, { borderColor: statusColor }]}
            testID={`unified-vault-status-${isCompleted ? "completed" : item.status}-${item.id}`}
          >
            <Feather name={statusIcon} size={10} color={statusColor} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {statusPillText}
            </Text>
          </View>
        </View>

        <View style={styles.rowBottom}>
          <Text style={styles.balanceValue}>{item.amountLabel}</Text>
          {usdLabel ? (
            <Text style={styles.balanceUsd} testID={`unified-vault-usd-${item.id}`}>
              {usdLabel}
            </Text>
          ) : null}
        </View>
        {item.progress != null ? (
          <View
            style={styles.progressTrack}
            testID={`unified-vault-progress-${item.kind}-${item.id}`}
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.round(item.progress * 100),
            }}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${item.progress * 100}%` },
              ]}
            />
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  wrapEmbedded: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  freeTierEyebrow: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
    marginBottom: 2,
  },
  headerBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 4,
  },
  aboutBtnLarge: {
    minWidth: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  aboutBtnLargeText: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  newBtnLarge: {
    minWidth: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  newBtnLargeText: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  modeToggle: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    padding: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginBottom: 2,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  modeBtnActive: {
    backgroundColor: colors.cyanMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cyan,
  },
  modeBtnText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  modeBtnTextActive: {
    color: colors.cyan,
  },
  newBadge: {
    marginLeft: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  newBadgeText: {
    color: colors.background,
    fontSize: 9,
    fontWeight: "800",
  },
  roleLabel: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginTop: 2,
  },
  dotNew: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
  loading: {
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerMuted,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  emptyCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    alignItems: "center",
    gap: spacing.sm,
    ...tileShadow(),
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  connectBtn: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.cyan,
    backgroundColor: colors.cyanMuted,
  },
  connectBtnText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "700",
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  vaultName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceElevated,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  vaultSub: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceElevated,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  rowBottom: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  balanceValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    ...typography.mono,
  },
  balanceUsd: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    ...typography.mono,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.spaceBlue,
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
    opacity: 0.72,
  },
});
