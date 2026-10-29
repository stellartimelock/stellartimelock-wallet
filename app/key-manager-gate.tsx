// Key Manager subscription gate screen.
//
// Shown when a non-subscribed, non-grandfathered user taps the Key button.
// Explains what Key Manager offers and shows a subscribe button.
// Grandfathered users and paid subscribers bypass this screen entirely.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";

const FEATURES = [
  {
    icon: "key" as const,
    title: "Any chain, one place",
    body: "Store secret keys for Stellar, Solana, Bitcoin, Ethereum, and more. Watch-only addresses need no private key at all.",
  },
  {
    icon: "eye" as const,
    title: "Read-only balance lookup",
    body: "Paste any public address and Key Manager fetches its current balance — no seed required for watch-only.",
  },
  {
    icon: "lock" as const,
    title: "Encrypted in your backup",
    body: "All saved keys are included in your encrypted .os backup file. If you lose your phone, restore from the backup.",
  },
  {
    icon: "shield" as const,
    title: "Serverless and private",
    body: "Keys never leave your device. No cloud, no sync, no accounts. Only your seed can decrypt the backup.",
  },
];

export default function KeyManagerGateScreen() {
  const router = useRouter();

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet"))}
          style={styles.backBtn}
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Key Manager</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.heroIcon}>
          <Feather name="key" size={36} color={colors.cyan} />
        </View>

        <Text style={styles.heroTitle}>Store keys for any chain</Text>
        <Text style={styles.heroSub}>
          Key Manager is a secure, encrypted vault for secret keys across every
          blockchain you use — all in one place.
        </Text>

        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Feather name={f.icon} size={16} color={colors.cyan} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.pricingCard}>
          <Text style={styles.pricingLabel}>INCLUDED WITH PLUS AND ABOVE</Text>
          <Text style={styles.pricingNote}>
            Key Manager is part of the StellarTimeLock Plus subscription ($5/mo)
            and all higher tiers. Subscribe once and keep your keys forever — even
            if you later downgrade.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.subscribeBtn}
          onPress={() => router.push("/tier-comparison")}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="View subscription plans"
        >
          <Feather name="star" size={16} color={colors.background} />
          <Text style={styles.subscribeBtnText}>View subscription plans</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backLink}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet"))}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backLinkText}>Maybe later</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    gap: spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.text,
    fontSize: 17,
    ...typography.heading,
  },
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    alignItems: "center",
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.cyanMuted,
    borderWidth: 1,
    borderColor: colors.borderGlow,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    ...tileShadow(),
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  heroSub: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 320,
    marginBottom: spacing.lg,
  },
  featureList: {
    alignSelf: "stretch",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceFrost,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.cyanMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  featureTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  featureBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  pricingCard: {
    alignSelf: "stretch",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.gold + "12",
    borderWidth: 1,
    borderColor: colors.gold + "44",
    marginBottom: spacing.lg,
    gap: 6,
  },
  pricingLabel: {
    color: colors.gold,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  pricingNote: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  subscribeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.cyan,
    marginBottom: spacing.md,
  },
  subscribeBtnText: {
    color: colors.background,
    fontSize: 15,
    fontWeight: "800",
  },
  backLink: {
    paddingVertical: spacing.sm,
  },
  backLinkText: {
    color: colors.textTertiary,
    fontSize: 13,
    fontWeight: "600",
  },
});
