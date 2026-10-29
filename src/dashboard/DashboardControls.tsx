import { Feather } from "@expo/vector-icons";
import React from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";

import { colors } from "@/src/theme";
import { formatAgo } from "@/src/utils/time";
import { type SortKey } from "@/src/vault/sort";

import { styles } from "./styles";

export const SORT_OPTIONS: {
  key: SortKey;
  label: string;
  icon: keyof typeof import("@expo/vector-icons").Feather.glyphMap;
}[] = [
  { key: "time", label: "Time remaining", icon: "clock" },
  { key: "amount", label: "Amount", icon: "trending-up" },
  { key: "created", label: "Created", icon: "calendar" },
];

export function SyncBadge({ lastSynced }: { lastSynced: number | null }) {
  const label = lastSynced == null ? "Synced just now" : `Synced ${formatAgo(lastSynced)}`;
  return (
    <View style={styles.syncBadgeRow} testID="dashboard-sync-badge">
      <Feather name="cloud" size={11} color={colors.textTertiary} />
      <Text style={styles.syncBadgeText}>{label}</Text>
      <Text style={styles.syncBadgeHint}>· pull down to re-sync</Text>
    </View>
  );
}

export function SortBar({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
}) {
  return (
    <View style={styles.sortRow}>
      <Text style={styles.sortLabel}>SORT BY</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sortChipRow}
        testID="dashboard-sort-row"
      >
        {SORT_OPTIONS.map((opt) => {
          const active = opt.key === value;
          return (
            <TouchableOpacity
              key={opt.key}
              testID={`dashboard-sort-${opt.key}`}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.85}
              style={[styles.sortChip, active && styles.sortChipActive]}
            >
              <Feather
                name={opt.icon}
                size={12}
                color={active ? colors.textInverse : colors.text}
              />
              <Text
                style={[
                  styles.sortChipText,
                  active && styles.sortChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function MarketDataCredit({
  ratesUpdatedAt,
}: {
  ratesUpdatedAt: number | null;
}) {
  const freshness =
    ratesUpdatedAt == null
      ? "Live price refreshing…"
      : `Updated ${formatAgo(ratesUpdatedAt)}`;
  return (
    <View style={styles.marketCredit} testID="dashboard-market-credit">
      <Feather name="bar-chart-2" size={11} color={colors.textTertiary} />
      <Text style={styles.marketCreditText}>
        Market rates derived from Stellar Horizon &amp; ECB.
      </Text>
      <Text style={styles.marketCreditHint}>· {freshness}</Text>
    </View>
  );
}
