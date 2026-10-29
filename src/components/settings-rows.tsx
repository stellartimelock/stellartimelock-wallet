// Grouped Settings rows — card sections used by the shipping Settings screen.

import { Feather } from "@expo/vector-icons";
import { type ComponentProps, type ReactNode } from "react";
import { Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";

import { colors, tileShadow } from "@/src/theme";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

export function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </View>
  );
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

interface RowProps {
  icon: ComponentProps<typeof Feather>["name"];
  label: string;
  sublabel?: string;
  value?: string;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
  right?: ReactNode;
  testID?: string;
  last?: boolean;
  accessibilityLabel?: string;
  labelNumberOfLines?: number;
}

export function SettingsRow({
  icon,
  label,
  sublabel,
  value,
  onPress,
  chevron = false,
  danger = false,
  right,
  testID,
  last = false,
  accessibilityLabel,
  labelNumberOfLines = 1,
}: RowProps) {
  const labelColor = danger ? colors.danger ?? "#EF4444" : colors.text;
  const content = (
    <View
      testID={onPress ? undefined : testID}
      style={[styles.row, last ? styles.rowLast : styles.rowBordered]}
    >
      <View style={styles.rowIconWrap}>
        <Feather
          name={icon}
          size={18}
          color={danger ? (colors.danger ?? "#EF4444") : colors.cyan}
        />
      </View>
      <View style={styles.rowBody}>
        <Text
          style={[styles.rowLabel, { color: labelColor }]}
          numberOfLines={labelNumberOfLines}
        >
          {label}
        </Text>
        {sublabel ? (
          <Text style={styles.rowSublabel} numberOfLines={2}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right ?? null}
      {chevron ? (
        <Feather
          name="chevron-right"
          size={16}
          color={colors.textTertiary}
          style={styles.rowChevron}
        />
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.65}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      {content}
    </TouchableOpacity>
  );
}

export function SettingsSwitchRow({
  icon,
  label,
  sublabel,
  value,
  onValueChange,
  disabled,
  last = false,
  testID,
}: {
  icon: ComponentProps<typeof Feather>["name"];
  label: string;
  sublabel?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.row, last ? styles.rowLast : styles.rowBordered]}
    >
      <View style={styles.rowIconWrap}>
        <Feather name={icon} size={18} color={colors.cyan} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={styles.rowSublabel} numberOfLines={2}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.borderSubtle, true: colors.cyan }}
        thumbColor={value ? "#ffffff" : colors.textTertiary}
        ios_backgroundColor={colors.borderSubtle}
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    paddingTop: 8,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  group: {
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    borderRadius: 12,
    overflow: "hidden",
    ...tileShadow(),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 56,
  },
  rowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  rowLast: {},
  rowIconWrap: {
    width: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  rowLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 20,
  },
  rowSublabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  rowValue: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: MONO,
    marginRight: 4,
    flexShrink: 1,
  },
  rowChevron: {
    marginLeft: 4,
  },
});
