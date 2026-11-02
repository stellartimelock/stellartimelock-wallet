// Confirm screen for a future Scopuly handoff. Not mounted.
// SCOPULY_SEP7_HANDOFF_ENABLED is false, and app/scopuly.tsx does not
// import this file. Scopuly may show only an operation name, so the
// amount, recipient, and unlock date are stated here.

import { StyleSheet, Text, View } from "react-native";

import { colors, radii } from "@/src/theme";

import type { VaultHandoffConfirm } from "./handoff";

export function ScopulyHandoffConfirm({
  preview,
}: {
  preview: VaultHandoffConfirm;
}) {
  return (
    <View testID="scopuly-handoff-confirm" style={styles.card}>
      <Text style={styles.title}>Check this before Scopuly</Text>
      <Text style={styles.note}>
        Scopuly may only show the operation name. The amount, recipient,
        and unlock date are here.
      </Text>
      <Text testID="scopuly-confirm-action" style={styles.line}>
        {preview.action}
      </Text>
      <Text testID="scopuly-confirm-amount" style={styles.line}>
        Amount {preview.amount}
      </Text>
      <Text testID="scopuly-confirm-recipient" style={styles.line}>
        Recipient {preview.recipient}
      </Text>
      <Text testID="scopuly-confirm-unlock" style={styles.line}>
        Unlock date {preview.unlockDate}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 12,
    gap: 4,
  },
  title: { color: colors.text, fontSize: 14, fontWeight: "800" },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  line: { color: colors.text, fontSize: 13, fontWeight: "700" },
});
