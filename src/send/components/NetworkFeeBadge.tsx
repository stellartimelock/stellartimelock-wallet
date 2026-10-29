import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { useNetworkFee } from "@/src/wallet/use-network-fee";
import { recommendedMaxFeeStroops, type Congestion } from "@/src/wallet/network-fee";
const CONGESTION_LABEL: Record<Congestion, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  unknown: "Live",
};
const CONGESTION_COLOR: Record<Congestion, string> = {
  low: colors.statusActive,
  medium: colors.gold,
  high: colors.danger,
  unknown: colors.statusPending,
};

export function NetworkFeeBadge({
  mode = "compact",
  onPress,
  testID,
}: {
  mode?: "compact" | "full";
  onPress?: () => void;
  testID?: string;
}) {
  const snap = useNetworkFee();
  const cong: Congestion = snap?.congestion ?? "unknown";
  const dot = CONGESTION_COLOR[cong];

  const bidStroops = parseInt(recommendedMaxFeeStroops(snap), 10);
  const bidXlm = Number.isFinite(bidStroops) ? bidStroops / 1e7 : 0;
  // Fee is per-tx; framing as "per 100 XLM sent" matches user mental model.
  const formulaText = `${bidXlm.toFixed(5)} XLM per 100 XLM sent`;

  const inner = (
    <>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      {mode === "compact" ? (
        <View style={styles.compactCol}>
          <Text style={styles.compactEyebrow}>ESTIMATED NETWORK FEE</Text>
          <Text style={styles.compactText} numberOfLines={1} testID="network-fee-formula">
            {formulaText}
          </Text>
        </View>
      ) : (
        <View style={styles.fullCol}>
          <Text style={styles.fullEyebrow}>ESTIMATED NETWORK FEE</Text>
          <Text style={styles.fullValue} testID="network-fee-formula">
            {formulaText}
          </Text>
          <Text style={[styles.fullSub, { color: dot }]}>
            {snap ? `${(snap.ledgerCapacityUsage * 100).toFixed(0)}% ledger capacity` : "checking…"}
          </Text>
        </View>
      )}
      {mode === "compact" ? (
        <Feather name="activity" size={11} color={colors.textTertiary} />
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={[styles.row, mode === "compact" ? styles.compact : styles.full]}
        testID={testID ?? "network-fee-badge"}
        accessibilityRole="button"
        accessibilityLabel={`Network fee — ${CONGESTION_LABEL[cong]} congestion`}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View
      style={[styles.row, mode === "compact" ? styles.compact : styles.full]}
      testID={testID ?? "network-fee-badge"}
    >
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  compact: {
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  full: {
    gap: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  compactCol: { flexShrink: 1 },
  compactEyebrow: {
    color: colors.textTertiary,
    fontSize: 9,
    ...typography.label,
  },
  compactText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  fullCol: { flex: 1 },
  fullEyebrow: { color: colors.textTertiary, fontSize: 10, ...typography.label },
  fullValue: { color: colors.text, fontSize: 13, ...typography.mono, marginTop: 2 },
  fullSub: { fontSize: 11, marginTop: 2, fontWeight: "600" },
});
