import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Vault } from "@/src/api/client";
import { Card } from "@/src/components/Card";
import { useSession } from "@/src/state/session";
import { colors, radii, spacing, typography } from "@/src/theme";
import { formatDaysRemaining, formatUnlockDate } from "@/src/vault/countdown";
import { useVaultSessionData } from "@/src/vault/useVaultSessionData";

export function ActiveVaultsSection() {
  const router = useRouter();
  const { wallet, formatXlm } = useSession();
  const { standard: vaults, loading, error } = useVaultSessionData();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const lockedVaults = (vaults ?? []).filter((v) => {
    const b = Number.isFinite(v.balance) ? v.balance : 0;
    return v.status === "locked" && b > 0;
  });
  const unlockedVaults = (vaults ?? []).filter((v) => {
    const b = Number.isFinite(v.balance) ? v.balance : 0;
    return v.status === "unlocked" && b > 0;
  });
  const withdrawnVaults = (vaults ?? []).filter(
    (v) => v.status === "withdrawn" || v.status === "archived",
  );
  const activeVaults = [...lockedVaults, ...unlockedVaults];

  return (
    <View style={styles.wrap} testID="crypto-active-vaults-section">
      <View style={styles.headerBtnRow}>
        <TouchableOpacity
          onPress={() => router.push("/create-vault")}
          style={styles.newBtnLarge}
          testID="crypto-vaults-new-button"
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Create a new vault"
        >
          <Feather name="plus" size={14} color={colors.textInverse} />
          <Text style={styles.newBtnLargeText}>New Vault</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() =>
            router.push({
              pathname: "/history",
              params: { source: "vaults" },
            })
          }
          style={styles.historyBtnLarge}
          testID="crypto-vaults-history-button"
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Vault history"
        >
          <Feather name="clock" size={14} color={colors.teal} />
          <Text style={styles.historyBtnLargeText}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/vault/about")}
          style={styles.aboutBtnLarge}
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

      <Text style={styles.eyebrow}>ACTIVE VAULTS</Text>

      {wallet && vaults == null && loading && !error ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.teal} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorRow}>
          <Feather name="alert-circle" size={12} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!wallet ? (
        <View style={styles.emptyCard} testID="crypto-vaults-no-wallet">
          <View style={styles.emptyIcon}>
            <Feather name="link" size={22} color={colors.teal} />
          </View>
          <Text style={styles.emptyTitle}>Connect a wallet to view vaults</Text>
          <Text style={styles.emptyBody}>
            Add or import a wallet to load your vaults and create new ones.
          </Text>
        </View>
      ) : null}

      {wallet && vaults != null && activeVaults.length === 0 && !error ? (
        <View style={styles.emptyCard} testID="crypto-vaults-empty">
          <View style={styles.emptyIcon}>
            <Feather name="lock" size={22} color={colors.teal} />
          </View>
          <Text style={styles.emptyTitle}>No vaults yet</Text>
          <Text style={styles.emptyBody}>
            Lock XLM or any Stellar token until any date up to 1000 days
            out. Once created it can&apos;t be opened early — a hands-off
            savings primitive.
          </Text>
        </View>
      ) : null}

      {lockedVaults.map((v) => (
        <VaultRowCompact
          key={v.vault_id}
          vault={v}
          formatXlm={formatXlm}
          onPress={() => router.push(`/vault/${v.vault_id}`)}
        />
      ))}

      {unlockedVaults.length > 0 ? (
        <View testID="crypto-vaults-ready-section">
          <Text style={[styles.eyebrow, styles.subEyebrow]}>
            READY TO WITHDRAW ({unlockedVaults.length})
          </Text>
          {unlockedVaults.map((v) => (
            <VaultRowCompact
              key={v.vault_id}
              vault={v}
              formatXlm={formatXlm}
              onPress={() => router.push(`/vault/${v.vault_id}`)}
            />
          ))}
        </View>
      ) : null}

      {withdrawnVaults.length > 0 ? (
        <View testID="crypto-vaults-history-section">
          <TouchableOpacity
            onPress={() => setHistoryExpanded((v) => !v)}
            style={styles.historyToggle}
            activeOpacity={0.8}
            testID="crypto-vaults-history-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: historyExpanded }}
          >
            <Feather name="archive" size={13} color={colors.textTertiary} />
            <Text style={styles.historyToggleText}>
              Withdrawn / History ({withdrawnVaults.length})
            </Text>
            <Feather
              name={historyExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
          {historyExpanded
            ? withdrawnVaults.map((v) => (
                <VaultRowCompact
                  key={v.vault_id}
                  vault={v}
                  formatXlm={formatXlm}
                  onPress={() => router.push(`/vault/${v.vault_id}`)}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

function VaultRowCompact({
  vault,
  onPress,
  formatXlm,
}: {
  vault: Vault;
  onPress: () => void;
  formatXlm: (n: number) => string;
}) {
  const status = vault.status;
  const target = vault.target_amount ?? 0;
  const progress = target > 0 ? Math.min(1, vault.balance / target) : 0;
  const statusColor =
    status === "locked"
      ? colors.teal
      : status === "unlocked"
        ? colors.gold
        : colors.textTertiary;
  const statusIcon =
    status === "locked" ? "lock" : status === "unlocked" ? "unlock" : "check";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      testID={`crypto-vault-row-${vault.vault_id}`}
    >
      <Card status={status} padded>
        <View style={styles.rowTop}>
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Text style={styles.vaultName} numberOfLines={1}>
              {vault.name}
            </Text>
            <Text style={styles.vaultSub} numberOfLines={1}>
              {status === "withdrawn"
                ? `Withdrawn · ${formatUnlockDate(vault.unlock_timestamp)}`
                : `${formatDaysRemaining(vault.unlock_timestamp)} · ${formatUnlockDate(vault.unlock_timestamp)}`}
            </Text>
          </View>
          <View
            style={[styles.statusPill, { borderColor: statusColor }]}
            testID={`crypto-vault-status-${status}-${vault.vault_id}`}
          >
            <Feather name={statusIcon} size={10} color={statusColor} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {status}
            </Text>
          </View>
        </View>

        <View style={styles.rowBottom}>
          <Text style={styles.balanceValue}>{formatXlm(vault.balance)}</Text>
          {target > 0 ? (
            <Text style={styles.targetValue}>
              of {formatXlm(target)}
            </Text>
          ) : null}
        </View>

        {target > 0 ? (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%`, backgroundColor: statusColor },
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
  headerBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 4,
  },
  aboutBtnLarge: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  aboutBtnLargeText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: "800",
  },
  newBtnLarge: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 12,
    borderRadius: radii.md,
    backgroundColor: colors.teal,
  },
  newBtnLargeText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  historyBtnLarge: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.teal,
    backgroundColor: colors.tealMuted,
  },
  historyBtnLargeText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  eyebrow: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
  },
  subEyebrow: {
    marginTop: spacing.md,
  },
  historyToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  historyToggleText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
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
    backgroundColor: colors.surface,
    alignItems: "center",
    gap: spacing.sm,
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
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  vaultName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
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
  targetValue: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: "600",
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.borderSubtle,
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
});
