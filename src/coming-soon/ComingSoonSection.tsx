// Visible Coming soon list — same grouped-row chrome as Settings.
// Wallet home keeps this collapsed and below real actions.

import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { SettingsGroup, SettingsRow } from "@/src/components/settings-rows";
import { colors, radii, spacing, typography } from "@/src/theme";

import { COMING_SOON_ITEMS } from "./items";

export function ComingSoonPill() {
  return (
    <View style={styles.pill} accessibilityLabel="Coming soon">
      <Text style={styles.pillText}>Soon</Text>
    </View>
  );
}

export function ComingSoonSection({
  testID = "coming-soon-section",
  variant = "wallet",
  defaultCollapsed = false,
}: {
  testID?: string;
  variant?: "wallet" | "settings";
  defaultCollapsed?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!defaultCollapsed);

  return (
    <View
      testID={testID}
      style={variant === "settings" ? styles.wrapSettings : styles.wrap}
    >
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={styles.headerBtn}
        testID={`${testID}-toggle`}
        accessibilityRole="button"
        accessibilityLabel={open ? "Hide coming soon" : "Show coming soon"}
      >
        <Text
          style={variant === "settings" ? styles.sectionSettings : styles.section}
        >
          Later
        </Text>
        <Text style={styles.toggleHint}>{open ? "Hide" : "Payouts & trends"}</Text>
      </TouchableOpacity>
      {open ? (
        <SettingsGroup>
          {COMING_SOON_ITEMS.map((item, index) => (
            <SettingsRow
              key={item.id}
              icon={item.icon}
              label={item.label}
              sublabel={item.sublabel}
              onPress={() => router.push(item.href)}
              chevron
              last={index === COMING_SOON_ITEMS.length - 1}
              testID={item.testID}
              accessibilityLabel={`${item.label}, Coming soon`}
              labelNumberOfLines={2}
              right={variant === "settings" ? <ComingSoonPill /> : undefined}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    opacity: 0.85,
  },
  wrapSettings: {
    alignSelf: "stretch",
    marginTop: spacing.md,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  section: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
  },
  sectionSettings: {
    color: colors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  toggleHint: {
    color: colors.textTertiary,
    fontSize: 11,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    marginRight: 4,
  },
  pillText: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
