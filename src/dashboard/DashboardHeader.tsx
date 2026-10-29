import React from "react";
import { Text, View } from "react-native";

import { Card } from "@/src/components/Card";
import { Summary } from "@/src/api/client";
import { colors, spacing } from "@/src/theme";
import { type HorizonBalance } from "@/src/wallet/horizon";

import { styles } from "./styles";

export function SummaryHeader({
  summary,
  formatXlm,
  formatFiat,
}: {
  summary: Summary | null;
  formatXlm: (n: number) => string;
  formatFiat: (n: number) => string;
}) {
  return (
    <View>
      <Text style={styles.sectionTitle}>Portfolio</Text>

      <Card padded style={styles.heroCard}>
        <Text style={styles.heroLabel}>TOTAL LOCKED</Text>
        <Text testID="summary-total-locked-xlm" style={styles.heroValue}>
          {formatXlm(summary?.total_locked ?? 0)}
        </Text>
        <Text testID="summary-total-locked-fiat" style={styles.heroFiat}>
          {formatFiat(summary?.total_locked ?? 0)}
        </Text>

        <View style={styles.divider} />

        <View style={styles.statsRow}>
          <Stat
            label="Unlocked"
            value={formatXlm(summary?.total_unlocked ?? 0)}
            tone="gold"
            testID="summary-total-unlocked"
          />
          <Stat
            label="Active"
            value={
              (summary?.active_vaults ?? 0) === 7
                ? `${summary?.active_vaults ?? 0} ☕`
                : String(summary?.active_vaults ?? 0)
            }
            testID="summary-active"
          />
          <Stat
            label="Completed"
            value={String(summary?.completed_vaults ?? 0)}
            testID="summary-completed"
          />
        </View>
      </Card>

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Your vaults</Text>
    </View>
  );
}

export function SpendableBalanceCard({
  horizon,
  formatXlm,
  formatFiat,
}: {
  horizon: HorizonBalance | null;
  formatXlm: (n: number) => string;
  formatFiat: (n: number) => string;
}) {
  if (!horizon) {
    return (
      <Card padded style={styles.spendableCard} testID="dashboard-spendable-card">
        <Text style={styles.spendableEyebrow}>SPENDABLE XLM</Text>
        <Text style={[styles.spendableValue, { color: colors.textTertiary }]}>—</Text>
        <Text style={styles.spendableHint}>Loading on-chain balance…</Text>
      </Card>
    );
  }

  if (horizon.state === "unfunded") {
    return (
      <Card padded style={styles.spendableCard} testID="dashboard-spendable-card">
        <Text style={styles.spendableEyebrow}>SPENDABLE XLM</Text>
        <Text style={[styles.spendableValue, { color: colors.textTertiary }]}>0.00 XLM</Text>
        <Text style={styles.spendableHint}>
          Account not yet funded on-chain. Send XLM to your address to start
          locking vaults.
        </Text>
      </Card>
    );
  }

  if (horizon.state === "error") {
    return (
      <Card padded style={styles.spendableCard} testID="dashboard-spendable-card">
        <Text style={styles.spendableEyebrow}>SPENDABLE XLM</Text>
        <Text style={[styles.spendableValue, { color: colors.danger }]}>—</Text>
        <Text style={styles.spendableHint}>
          Couldn&apos;t reach Horizon — pull down to retry.
        </Text>
      </Card>
    );
  }

  return (
    <Card padded style={styles.spendableCard} testID="dashboard-spendable-card">
      <Text style={styles.spendableEyebrow}>SPENDABLE XLM</Text>
      <Text style={styles.spendableValue} testID="dashboard-spendable-value">
        {formatXlm(horizon.spendable)}
      </Text>
      <Text style={styles.spendableFiat}>{formatFiat(horizon.spendable)}</Text>

      <View style={styles.spendableDivider} />

      <View style={styles.spendableRow}>
        <Text style={styles.spendableRowLabel}>Total on-chain</Text>
        <Text style={styles.spendableRowValue}>{formatXlm(horizon.total)}</Text>
      </View>
      <View style={styles.spendableRow}>
        <Text style={styles.spendableRowLabel}>
          Protocol reserve · {horizon.subentries} subentr
          {horizon.subentries === 1 ? "y" : "ies"}
        </Text>
        <Text style={styles.spendableRowValue}>
          −{formatXlm(horizon.reserve)}
        </Text>
      </View>
      {horizon.liabilities > 0 ? (
        <View style={styles.spendableRow}>
          <Text style={styles.spendableRowLabel}>Liabilities</Text>
          <Text style={styles.spendableRowValue}>
            −{formatXlm(horizon.liabilities)}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
  testID,
}: {
  label: string;
  value: string;
  tone?: "gold";
  testID?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        testID={testID}
        style={[styles.statValue, tone === "gold" && { color: colors.gold }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}
