// Tier comparison — Free vs Plus vs Pro vs Elite pricing cards.
//
// Every value on this page is derived from src/tiers/tier-config.ts (and the
// existing Plus+ gate for Key Manager / multi-wallet import) so the chart
// can never drift from the real tier gating rules.

import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { accentGlow, colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import { canUseKeyManagerWalletSync } from "@/src/wallet/key-manager-wallet-sync";
import {
  getCurrentTier,
  hydrateTier,
  TIER_CONFIGS,
  TIER_ORDER,
  VAULT_TYPE_LABELS,
  type TierConfig,
  type TierId,
  type TierVaultType,
} from "@/src/tiers/tier-config";

interface FeatureLine {
  key: string;
  label: string;
  included: boolean;
}

/** Stable vault-type order for aligned checklists across cards. */
const ALL_VAULT_TYPES = Object.keys(VAULT_TYPE_LABELS) as TierVaultType[];

/** Feature list for one tier — still sourced only from tier-config + Plus gate. */
function buildFeatures(tier: TierId, cfg: TierConfig): FeatureLine[] {
  const vaultLimit =
    cfg.vaultLimit == null ? "Unlimited vaults" : `${cfg.vaultLimit} vaults`;
  const depositLimit =
    cfg.monthlyDepositLimitUsd == null
      ? "Unlimited deposits"
      : `$${cfg.monthlyDepositLimitUsd.toLocaleString()}/mo`;

  const lines: FeatureLine[] = [
    { key: "vaultLimit", label: vaultLimit, included: true },
    { key: "depositLimit", label: depositLimit, included: true },
  ];

  // Same vault-type rows on every card so columns stay aligned.
  for (const type of ALL_VAULT_TYPES) {
    lines.push({
      key: `vt-${type}`,
      label: VAULT_TYPE_LABELS[type],
      included: cfg.vaultTypes.includes(type),
    });
  }

  const plusFeatures = canUseKeyManagerWalletSync(tier);
  lines.push(
    { key: "keyManager", label: "Key Manager", included: plusFeatures },
    { key: "multiWallet", label: "Multi-wallet", included: plusFeatures },
    {
      key: "dashboard",
      label: tier === "free" ? "Dashboard" : `${cfg.label} dash`,
      included: tier !== "free",
    },
  );

  return lines;
}

function priceDisplay(tier: TierId, cfg: TierConfig): { amount: string; period: string } {
  if (tier === "free") return { amount: "$0", period: "forever" };
  const raw = cfg.priceLabel; // e.g. "$5/mo"
  const slash = raw.indexOf("/");
  if (slash > 0) {
    return { amount: raw.slice(0, slash), period: `per ${raw.slice(slash + 1)}` };
  }
  return { amount: raw, period: "" };
}

function TierCard({
  tier,
  isCurrent,
  compact,
}: {
  tier: TierId;
  isCurrent: boolean;
  compact: boolean;
}) {
  const cfg = TIER_CONFIGS[tier];
  const features = useMemo(() => buildFeatures(tier, cfg), [tier, cfg]);
  const price = priceDisplay(tier, cfg);

  return (
    <View
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        isCurrent ? styles.cardCurrent : null,
      ]}
      testID={`tier-comparison-column-${tier}`}
    >
      {isCurrent ? (
        <View
          style={styles.currentBadge}
          testID={`tier-comparison-current-badge-${tier}`}
        >
          <Text style={styles.currentBadgeText}>CURRENT</Text>
        </View>
      ) : (
        <View style={styles.badgeSpacer} />
      )}

      <Text
        style={[styles.tierName, isCurrent ? styles.tierNameCurrent : null]}
        numberOfLines={1}
      >
        {cfg.label}
      </Text>

      <View style={styles.priceBlock}>
        <Text
          style={[styles.priceAmount, compact ? styles.priceAmountCompact : null]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {price.amount}
        </Text>
        {price.period ? (
          <Text style={styles.pricePeriod} numberOfLines={1}>
            {price.period}
          </Text>
        ) : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.featureList}>
        {features.map((f) => (
          <View key={f.key} style={styles.featureRow}>
            <Feather
              name={f.included ? "check" : "x"}
              size={compact ? 11 : 13}
              color={f.included ? colors.success : colors.textTertiary}
              style={styles.featureIcon}
            />
            <Text
              style={[
                styles.featureText,
                compact ? styles.featureTextCompact : null,
                !f.included ? styles.featureTextMuted : null,
              ]}
              numberOfLines={compact ? 2 : 1}
            >
              {f.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function TierComparisonScreen() {
  const [currentTier, setCurrentTier] = useState<TierId>(getCurrentTier());
  const { width } = useWindowDimensions();
  // Side-by-side on typical phones+; stack 2×2 only on very narrow widths.
  const sideBySide = width >= 340;
  const compact = width < 420;

  useFocusEffect(
    useCallback(() => {
      void hydrateTier().then(setCurrentTier);
    }, []),
  );

  return (
    <SafeAreaView
      edges={["top"]}
      style={styles.root}
      testID="tier-comparison-screen"
    >
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/wallet")
          }
          style={styles.headerBack}
          testID="tier-comparison-back"
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Compare Tiers
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Pick the plan that matches how you vault — Free through Elite.
        </Text>

        <View
          style={[
            styles.cardsRow,
            !sideBySide ? styles.cardsStacked : null,
          ]}
          testID="tier-comparison-chart"
        >
          {TIER_ORDER.map((tier) => (
            <View
              key={tier}
              style={sideBySide ? styles.cardSlot : styles.cardSlotStacked}
            >
              <TierCard
                tier={tier}
                isCurrent={tier === currentTier}
                compact={compact && sideBySide}
              />
            </View>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => router.push("/settings")}
          style={styles.settingsLink}
          testID="tier-comparison-manage-link"
          accessibilityRole="button"
          accessibilityLabel="Manage test tier in Settings"
        >
          <Text style={styles.settingsLinkText}>
            Manage your tier in Settings →
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    gap: 8,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    color: colors.text,
    ...typography.heading,
  },
  body: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  intro: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.md,
    marginHorizontal: spacing.sm,
    color: colors.textSecondary,
    textAlign: "center",
  },
  cardsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
  },
  cardsStacked: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cardSlot: {
    flex: 1,
    minWidth: 0,
  },
  cardSlotStacked: {
    width: "48%",
    flexGrow: 1,
    marginBottom: 6,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 12,
    ...tileShadow(),
  },
  cardCompact: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 10,
  },
  cardCurrent: {
    borderColor: colors.cyan,
    borderWidth: 2,
    backgroundColor: colors.cyanMuted,
    ...accentGlow("rgba(94, 159, 255, 0.35)"),
  },
  badgeSpacer: {
    height: 18,
    marginBottom: 4,
  },
  currentBadge: {
    alignSelf: "center",
    backgroundColor: colors.cyanMuted,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.cyan,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 4,
    height: 18,
    justifyContent: "center",
  },
  currentBadgeText: {
    color: colors.cyan,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  tierName: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.2,
    color: colors.text,
    textAlign: "center",
  },
  tierNameCurrent: {
    color: colors.cyan,
  },
  priceBlock: {
    alignItems: "center",
    marginTop: 6,
    marginBottom: 4,
    minHeight: 44,
    justifyContent: "center",
  },
  priceAmount: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.cyan,
    letterSpacing: -0.5,
  },
  priceAmountCompact: {
    fontSize: 16,
  },
  pricePeriod: {
    fontSize: 10,
    color: colors.textTertiary,
    fontWeight: "600",
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginVertical: 8,
  },
  featureList: {
    gap: 6,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  featureIcon: {
    marginTop: 1,
  },
  featureText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    color: colors.text,
  },
  featureTextCompact: {
    fontSize: 9,
    lineHeight: 12,
  },
  featureTextMuted: {
    color: colors.textTertiary,
    fontWeight: "500",
  },
  settingsLink: {
    marginTop: spacing.lg,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  settingsLinkText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.cyan,
  },
});
