// Thank-you screen shown after a donation is accepted.
// Route: /homeless-trillionaire

import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/src/theme";

function oneParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default function HomelessTrillionaireScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ amount?: string }>();
  const amount = oneParam(params.amount).trim();

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={styles.root}
      testID="homeless-trillionaire-screen"
    >
      <View style={styles.center}>
        <Text style={styles.eyebrow}>Thank you</Text>
        <View style={styles.rule} />
        <Text style={styles.title} accessibilityRole="header">
          Homeless Trillionaire
        </Text>
        <Text style={styles.body}>
          Thank you for the donation. The vault still opens only on the date
          you set. This screen is the thanks.
        </Text>
        {amount ? (
          <Text style={styles.amount} testID="homeless-trillionaire-amount">
            {amount} XLM
          </Text>
        ) : null}
        <TouchableOpacity
          style={styles.done}
          onPress={() => router.replace("/settings")}
          testID="homeless-trillionaire-done"
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
        >
          <Text style={styles.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  eyebrow: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2.4,
    textTransform: "uppercase",
  },
  rule: {
    width: 48,
    height: 2,
    backgroundColor: colors.cyan,
    marginTop: 16,
    marginBottom: 20,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginTop: 18,
  },
  amount: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 22,
  },
  done: {
    marginTop: 32,
    minWidth: 160,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.cyan,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  doneLabel: {
    color: "#04140f",
    fontSize: 16,
    fontWeight: "700",
  },
});
