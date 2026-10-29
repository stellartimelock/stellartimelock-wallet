// First-run: Guided tour vs Skip — shown after value-prop Continue
// when the user has no wallet yet and has not answered before.

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
import { SafeAreaView } from "react-native-safe-area-context";

import { setTourChoice, type GuidedTourChoice } from "@/src/onboarding/guided-tour";
import { colors, radii, spacing, typography } from "@/src/theme";

export default function OnboardingChoice() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const choose = async (choice: GuidedTourChoice) => {
    if (busy) return;
    setBusy(true);
    try {
      await setTourChoice(choice);
      router.replace("/wallet-setup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="onboarding-choice-screen">
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Feather name="compass" size={28} color={colors.teal} />
        </View>
        <Text style={styles.title} testID="onboarding-choice-title">
          How do you want to start?
        </Text>
        <Text style={styles.subtitle}>
          A time-lock vault holds your XLM on-chain until a date you choose.
          Pick a short guided walkthrough, or skip and explore on your own.
        </Text>

        <TouchableOpacity
          testID="onboarding-choice-guided"
          style={[styles.card, styles.cardRecommended]}
          activeOpacity={0.85}
          disabled={busy}
          onPress={() => void choose("guided")}
          accessibilityRole="button"
          accessibilityLabel="Start guided tour"
        >
          <View style={styles.cardIcon}>
            <Feather name="map" size={20} color={colors.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>Guided tour</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>RECOMMENDED</Text>
              </View>
            </View>
            <Text style={styles.cardBody}>
              Walk through creating your first time-lock vault with clear
              unlock instructions and confirmation messages.
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity
          testID="onboarding-choice-skip"
          style={styles.card}
          activeOpacity={0.85}
          disabled={busy}
          onPress={() => void choose("skipped")}
          accessibilityRole="button"
          accessibilityLabel="Skip guided tour"
        >
          <View style={styles.cardIcon}>
            <Feather name="zap" size={20} color={colors.textSecondary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Skip — I will explore</Text>
            <Text style={styles.cardBody}>
              Jump straight to wallet setup. You can create a vault anytime
              from the Wallet tab.
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.textTertiary} />
        </TouchableOpacity>

        {busy ? (
          <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.md }} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  body: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    ...typography.display,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  cardRecommended: {
    borderColor: colors.teal,
    borderWidth: 1,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 3,
    flexWrap: "wrap",
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.tealMuted,
  },
  badgeText: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  cardBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
});
