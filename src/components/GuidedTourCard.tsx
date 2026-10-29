// Compact step coach for first time-lock vault creation.
// Only mounts when guided tour is active.

import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors, radii, spacing, typography } from "@/src/theme";

export type GuidedTourStepId = 0 | 1 | 2 | 3;

export const GUIDED_TOUR_STEPS: {
  id: GuidedTourStepId;
  title: string;
  body: string;
}[] = [
  {
    id: 0,
    title: "What is a time-lock?",
    body:
      "You deposit XLM into an on-chain vault. Funds stay locked until the unlock time you set — nobody (including this app) can withdraw early.",
  },
  {
    id: 1,
    title: "Name and deposit",
    body:
      "Give the vault a clear name and enter how much XLM to lock. Keep a little spare XLM in your wallet for network fees (~0.01 XLM).",
  },
  {
    id: 2,
    title: "Set the unlock",
    body:
      "Use Duration (days + hours) or Unlock by date. Minimum lock is 1 hour. Double-check the Summary unlock time before you submit.",
  },
  {
    id: 3,
    title: "Confirm and lock",
    body:
      "Review the Summary card, then tap Lock funds. You will sign the Stellar transaction. On success you will see a clear confirmation with the unlock date.",
  },
];

export function GuidedTourCard({
  step,
  onNext,
  onBack,
  onSkip,
}: {
  step: GuidedTourStepId;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const meta = GUIDED_TOUR_STEPS[step] ?? GUIDED_TOUR_STEPS[0];
  const isLast = step >= GUIDED_TOUR_STEPS.length - 1;

  return (
    <View style={styles.card} testID="guided-tour-card">
      <View style={styles.header}>
        <View style={styles.stepPill}>
          <Text style={styles.stepPillText} testID="guided-tour-step-label">
            TOUR {step + 1}/{GUIDED_TOUR_STEPS.length}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onSkip}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="guided-tour-skip"
          accessibilityRole="button"
          accessibilityLabel="End guided tour"
        >
          <Text style={styles.skip}>End tour</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title} testID="guided-tour-title">
        {meta.title}
      </Text>
      <Text style={styles.body} testID="guided-tour-body">
        {meta.body}
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onBack}
          disabled={step === 0}
          style={[styles.navBtn, step === 0 && styles.navBtnDisabled]}
          testID="guided-tour-back"
        >
          <Feather
            name="chevron-left"
            size={16}
            color={step === 0 ? colors.textTertiary : colors.text}
          />
          <Text
            style={[styles.navText, step === 0 && styles.navTextDisabled]}
          >
            Back
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onNext}
          style={styles.nextBtn}
          testID="guided-tour-next"
        >
          <Text style={styles.nextText}>{isLast ? "Got it" : "Next tip"}</Text>
          <Feather name={isLast ? "check" : "chevron-right"} size={16} color={colors.textInverse} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.teal,
    padding: spacing.md,
    gap: 8,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  stepPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: colors.tealMuted,
  },
  stepPillText: {
    ...typography.label,
    color: colors.teal,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  skip: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: "600",
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  navBtnDisabled: { opacity: 0.45 },
  navText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  navTextDisabled: { color: colors.textTertiary },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.teal,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  nextText: {
    color: colors.textInverse,
    fontSize: 13,
    fontWeight: "700",
  },
});
