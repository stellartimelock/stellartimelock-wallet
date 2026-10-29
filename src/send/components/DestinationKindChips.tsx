// CRITICAL: chip choice is UI metadata only — submit gate uses resolveAddressRisk(), not kindId.

import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing } from "@/src/theme";


export const DESTINATION_KINDS = [
  { id: "private", label: "Private Wallet" },
  { id: "exchange", label: "Exchange / Custodial" },
  { id: "casino", label: "Casino" },
  { id: "donation", label: "Donation" },
] as const;
export type DestinationKindId = (typeof DESTINATION_KINDS)[number]["id"];


export function DestinationKindChips({
  value,
  onChange,
  disabled = false,
}: {
  value: DestinationKindId;
  onChange: (id: DestinationKindId) => void;
  /** When true (saved contact loaded), chips are display-only. */
  disabled?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {DESTINATION_KINDS.map((k) => {
        const active = value === k.id;
        return (
          <Pressable
            key={k.id}
            onPress={() => {
              if (!disabled) onChange(k.id);
            }}
            disabled={disabled}
            style={[
              styles.chip,
              active && styles.chipActive,
              disabled && !active && styles.chipDisabled,
            ]}
            testID={`send-kind-${k.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, checked: active, disabled }}
          >
            {active ? (
              <Feather
                name="check"
                size={16}
                color={colors.textInverse}
                testID={`send-kind-${k.id}-check`}
              />
            ) : null}
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
            >
              {k.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceFrost,
    borderWidth: 1.5,
    borderColor: colors.textTertiary,
  },
  // Selected = filled + checkmark, so the choice is obvious at a glance.
  chipActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  chipTextActive: { color: colors.textInverse, fontWeight: "800" },
});

export { spacing as _spacing };
