import React from "react";
import { StyleSheet, View, ViewProps, ViewStyle } from "react-native";

import { accentGlow, colors, radii, spacing, tileShadow } from "@/src/theme";

interface Props extends ViewProps {
  status?: "locked" | "unlocked" | "withdrawn" | "archived" | "neutral";
  padded?: boolean;
}

export function Card({
  status = "neutral",
  padded = true,
  style,
  children,
  ...rest
}: Props) {
  return (
    <View
      {...rest}
      style={[
        styles.card,
        padded && styles.padded,
        accent[status],
        style as ViewStyle,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceFrost,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...tileShadow(),
  },
  padded: { padding: spacing.md + 4 },
});

const accent: Record<NonNullable<Props["status"]>, ViewStyle> = {
  locked: {
    borderLeftWidth: 3,
    borderLeftColor: colors.cyan,
    ...accentGlow("rgba(0, 229, 255, 0.28)"),
  },
  unlocked: {
    borderLeftWidth: 3,
    borderLeftColor: colors.statusActive,
    ...accentGlow(colors.cyanGlow),
  },
  withdrawn: {
    borderLeftWidth: 3,
    borderLeftColor: colors.statusClosed,
    opacity: 0.7,
  },
  // Soroban TTL pruning — card hydrates from backend meta side-store.
  archived: {
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    opacity: 0.85,
    ...accentGlow(colors.goldGlow),
  },
  neutral: {},
};
