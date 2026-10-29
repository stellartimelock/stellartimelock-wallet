// First-run value prop — what Stellar TimeLock is and why you'd want it.
// Shown once after theatrical splash, before Guided vs Skip.
// Skipped when tour choice is already set or value-prop already seen.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { markValuePropSeen } from "@/src/onboarding/guided-tour";
import { colors, radii, spacing, typography } from "@/src/theme";

const POINTS: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Lock funds until a date you choose",
    body: "Put XLM in an on-chain vault so you can't impulsively spend or gamble it.",
  },
  {
    icon: "shield",
    title: "Nobody unlocks early — including this app",
    body: "The unlock time lives on Stellar. Your keys stay yours.",
  },
  {
    icon: "clock",
    title: "You control when money comes back",
    body: "Pick hours, days, or a calendar date. Funds stay locked until then.",
  },
  {
    icon: "shield",
    title: "Protect exchange transfers with memos",
    body: "Required memos and saved contacts help prevent lost funds.",
  },
];

export default function ValuePropWelcome() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  const continueNext = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markValuePropSeen();
      router.replace("/onboarding-choice" as never);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]} testID="value-prop-screen">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.md }]}
        showsVerticalScrollIndicator={false}
        testID="value-prop-scroll"
      >
        <View style={styles.iconWrap}>
          <Feather name="lock" size={28} color={colors.teal} />
        </View>
        <Text style={styles.kicker} testID="value-prop-kicker">
          STELLAR TIMELOCK
        </Text>
        <Text style={styles.title} testID="value-prop-title">
          Crypto you can't spend on a whim
        </Text>
        <Text style={styles.subtitle} testID="value-prop-subtitle">
          A Stellar wallet with time-lock vaults. Set money aside, lock it on-chain,
          and choose when it unlocks — so impulse has nowhere to go.
        </Text>

        <View style={styles.points}>
          {POINTS.map((p) => (
            <View key={p.title} style={styles.pointRow}>
              <View style={styles.pointIcon}>
                <Feather name={p.icon} size={18} color={colors.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pointTitle}>{p.title}</Text>
                <Text style={styles.pointBody}>{p.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.spacer} />

        <View style={styles.footer}>
          <TouchableOpacity
            testID="value-prop-continue"
            style={[styles.cta, busy && styles.ctaDisabled]}
            activeOpacity={0.85}
            disabled={busy}
            onPress={() => void continueNext()}
            accessibilityRole="button"
            accessibilityLabel="Continue to how you want to start"
          >
            {busy ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <>
                <Text style={styles.ctaText}>Continue</Text>
                <Feather name="arrow-right" size={18} color={colors.textInverse} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  body: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  kicker: {
    ...typography.label,
    color: colors.teal,
    fontSize: 11,
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    ...typography.display,
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  points: {
    gap: spacing.md,
  },
  pointRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
  },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    backgroundColor: colors.tealMuted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  pointTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 3,
  },
  pointBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  spacer: { flex: 1, minHeight: spacing.lg },
  footer: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    minHeight: 52,
  },
  ctaDisabled: { opacity: 0.7 },
  ctaText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: "700",
  },
});
