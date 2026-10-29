import { Feather } from "@expo/vector-icons";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { colors, spacing, typography } from "@/src/theme";
import { useSession } from "@/src/state/session";

import { trimAmount } from "@/src/tap-pay/money";
import { loadTapPay } from "@/src/tap-pay/history-device";
import type { TapPayment } from "@/src/tap-pay/save";

export default function TapPayHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { network } = useSession();
  const [recent, setRecent] = useState<TapPayment[]>([]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void loadTapPay().then((doc) => {
      if (!alive) return;
      setRecent([...doc.payments].reverse().slice(0, 8));
    });
    return () => {
      alive = false;
    };
  }, []));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Text style={styles.headerBtn} onPress={() => router.back()}>
          <Feather name="chevron-left" size={20} color={colors.text} />
        </Text>
        <Text style={styles.title}>Request or pay</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
        <Text style={styles.body}>
          Request XLM on this phone, or pay a request from another phone. NFC carries the link when it is on. A QR code and the same Stellar link work when it is not. A tap alone never sends — you still confirm twice.
        </Text>
        <Text style={styles.caption}>{network === "testnet" ? "Testnet is on." : "Mainnet is on."}</Text>
        <Button label="Request payment" onPress={() => router.push("/tap-pay/request")} style={{ marginTop: spacing.lg }} testID="tap-home-request" />
        <Button label="Pay" onPress={() => router.push("/tap-pay/pay")} variant="secondary" style={{ marginTop: spacing.sm }} testID="tap-home-pay" />
        <Text style={styles.kicker}>RECENT</Text>
        {recent.length === 0 ? <Text style={styles.caption}>No tap-to-pay history on this phone yet.</Text> : null}
        {recent.map((payment) => (
          <View key={`${payment.hash}-${payment.role}`} style={styles.row}>
            <Text style={styles.body}>{payment.role === "pay" ? "Sent" : "Received"} {trimAmount(payment.amount)} XLM</Text>
            <Text selectable style={styles.caption}>{payment.role === "pay" ? payment.destination : payment.source}</Text>
            <Text style={styles.caption}>{payment.network} · {payment.hash.slice(0, 10)}…</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerBtn: { width: 32 },
  title: { flex: 1, textAlign: "center", color: colors.text, fontSize: 18, ...typography.heading },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  caption: { color: colors.textSecondary, marginTop: spacing.xs, fontSize: 13 },
  kicker: { color: colors.textTertiary, marginTop: spacing.lg, ...typography.label, fontSize: 11 },
  row: { marginTop: spacing.md },
});
