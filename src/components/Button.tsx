import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";

import { accentGlow, colors, radii } from "@/src/theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Feather.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: ViewStyle;
  numberOfLines?: number;
  illuminated?: boolean;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  testID,
  style,
  numberOfLines = 1,
  illuminated,
}: Props) {
  const isDisabled = disabled || loading;
  const v = variantStyles[variant];
  const multilineHeight = numberOfLines > 1 ? { minHeight: 64 } : null;
  const illuminatedContainer = illuminated && variant === "danger" ? styles.illuminatedDanger : null;
  const illuminatedText = illuminated && variant === "danger" ? styles.illuminatedDangerText : null;
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        styles.base,
        v.container,
        illuminatedContainer,
        isDisabled && styles.disabled,
        multilineHeight,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={illuminatedText?.color ?? v.text.color} size="small" />
        ) : (
          <>
            {icon ? <Feather name={icon} size={18} color={illuminatedText?.color ?? v.text.color} /> : null}
            <Text
              style={[
                styles.label,
                v.text,
                illuminatedText,
                { flexShrink: 1 },
                numberOfLines > 1 && styles.labelMultiline,
              ]}
              numberOfLines={numberOfLines}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 40,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  labelMultiline: { lineHeight: 18 },
  disabled: { opacity: 0.4 },
  illuminatedDanger: {
    backgroundColor: colors.dangerMuted,
    borderColor: colors.danger,
    borderWidth: 1,
    ...accentGlow("rgba(224, 69, 69, 0.45)"),
  },
  illuminatedDangerText: {
    color: colors.textInverse,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
});

const variantStyles: Record<Variant, { container: ViewStyle; text: { color: string } }> = {
  primary: {
    container: {
      backgroundColor: colors.cyanMuted,
      borderWidth: 1,
      borderColor: colors.cyan,
      ...accentGlow("rgba(0, 229, 255, 0.45)"),
    },
    text: { color: colors.textInverse },
  },
  secondary: {
    container: {
      backgroundColor: colors.surfaceFrost,
      borderWidth: 1,
      borderColor: colors.borderGlow,
      ...accentGlow(),
    },
    text: { color: colors.text },
  },
  ghost: {
    container: { backgroundColor: "transparent" },
    text: { color: colors.cyan },
  },
  danger: {
    container: {
      backgroundColor: colors.dangerMuted,
      borderWidth: 1,
      borderColor: colors.danger,
      ...accentGlow("rgba(224, 69, 69, 0.30)"),
    },
    text: { color: colors.danger },
  },
};
