// Detail page for a Coming soon placeholder. No feature logic.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";

import { type ComingSoonId, getComingSoonItem } from "./items";

export function ComingSoonPage({ id }: { id: ComingSoonId }) {
  const router = useRouter();
  const item = getComingSoonItem(id);

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID={item.screenTestID}>
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet")
          }
          style={styles.headerBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID={`${item.testID}-back`}
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{item.label}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Feather name={item.icon} size={26} color={colors.gold} />
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Coming soon</Text>
          </View>
          <Text style={styles.title}>{item.label}</Text>
          <Text style={styles.copy}>{item.screenBody}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    alignItems: "flex-start",
    gap: spacing.sm,
    ...tileShadow(),
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.goldMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    marginBottom: spacing.xs,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gold,
    backgroundColor: colors.goldMuted,
  },
  badgeText: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: colors.text,
    fontSize: 22,
    ...typography.display,
    marginTop: spacing.xs,
  },
  copy: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
  },
});
