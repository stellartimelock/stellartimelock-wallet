import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";

import { colors } from "@/src/theme";

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** String label or a ReactNode for rich content (links, colored spans). */
  label?: React.ReactNode;
  /** Disables the box (still renders — greyed out). */
  disabled?: boolean;
  testID?: string;
  /** Optional style override on the outer row. */
  style?: StyleProp<ViewStyle>;
  /** Optional style override on the label Text (ignored when label is a node). */
  labelStyle?: StyleProp<TextStyle>;
  /** Screen reader label — defaults to the string form of `label`. */
  accessibilityLabel?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  testID,
  style,
  labelStyle,
  accessibilityLabel,
}: CheckboxProps) {
  const a11yLabel =
    accessibilityLabel ??
    (typeof label === "string" ? label : undefined);

  return (
    <Pressable
      onPress={() => !disabled && onChange(!checked)}
      style={[styles.row, style, disabled && styles.rowDisabled]}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={a11yLabel}
      hitSlop={8}
    >
      <View
        style={[
          styles.box,
          checked && styles.boxChecked,
          disabled && styles.boxDisabled,
        ]}
      >
        {checked ? (
          <Feather name="check" size={18} color={colors.textInverse} />
        ) : null}
      </View>
      {label !== undefined && label !== null ? (
        typeof label === "string" ? (
          <Text style={[styles.label, labelStyle]}>{label}</Text>
        ) : (
          <View style={styles.labelWrap}>{label}</View>
        )
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 10,
  },
  rowDisabled: { opacity: 0.5 },
  box: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1, // Align box with first line of multi-line label
  },
  boxChecked: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  boxDisabled: {
    borderColor: colors.textTertiary,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  labelWrap: { flex: 1 },
});

export default Checkbox;
