// Donate — signs an on-device XLM payment, then opens the thank-you screen.
// Route: /donate
//
// completeDonation only navigates on success. The sender is the same
// broadcast path the Send screen uses, with kind "donation" so the
// exchange/casino memo gate is not involved.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  completeDonation,
  type DonationDraft,
} from "@/src/donations/donate";
import { broadcastPayment } from "@/src/send/broadcast";
import { useSession } from "@/src/state/session";
import { colors, tileShadow } from "@/src/theme";

const PRESETS = ["5", "20", "50"];

// Same Development Fund address the Send screen's Donation chip fills.
const PROJECT_DONATION_ADDRESS =
  "GCB5OFIMXRDSC7PM4GOHQUIAHEKIG6T7JLTO3LGVVVNEXAA5JXANKPIC";

export default function DonateScreen() {
  const router = useRouter();
  const { wallet } = useSession();
  const [amount, setAmount] = useState("20");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await completeDonation(amount, async (draft: DonationDraft) => {
      if (!wallet?.secretSeed) {
        throw new Error("Add a wallet seed before donating.");
      }
      const outcome = await broadcastPayment({
        keypair: wallet,
        destination: PROJECT_DONATION_ADDRESS,
        amountXlm: Number(draft.amountXlm),
        memo: draft.memo,
        kindId: "donation",
      });
      if (!outcome.ok) {
        throw new Error(outcome.message);
      }
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    router.push({
      pathname: "/homeless-trillionaire",
      params: { amount: result.amountXlm },
    });
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="donate-screen">
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/settings")
          }
          style={styles.headerBack}
          hitSlop={12}
          accessibilityLabel="Back"
          testID="donate-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Donate</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.lead}>
          Send a gift in XLM to the developer. Confirming signs the payment
          on this device and, once it is accepted, opens a thank-you.
        </Text>

        <View style={styles.presets}>
          {PRESETS.map((preset) => {
            const selected = amount === preset;
            return (
              <TouchableOpacity
                key={preset}
                style={[styles.preset, selected ? styles.presetOn : null]}
                onPress={() => {
                  setAmount(preset);
                  setError(null);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`donate-preset-${preset}`}
              >
                <Text style={[styles.presetLabel, selected ? styles.presetLabelOn : null]}>
                  {preset} XLM
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Amount (XLM)</Text>
        <TextInput
          value={amount}
          onChangeText={(next) => {
            setAmount(next);
            setError(null);
          }}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          testID="donate-amount"
          accessibilityLabel="Donation amount in XLM"
        />

        {error ? (
          <Text style={styles.error} testID="donate-error">
            {error}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.confirm, submitting ? styles.confirmBusy : null]}
          onPress={() => {
            void confirm();
          }}
          disabled={submitting}
          testID="donate-confirm"
          accessibilityRole="button"
          accessibilityLabel="Confirm donation"
        >
          <Text style={styles.confirmLabel}>
            {submitting ? "Sending…" : "Confirm donation"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  body: { padding: 20, paddingBottom: 48 },
  lead: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  presets: {
    flexDirection: "row",
    gap: 8,
    marginTop: 20,
  },
  preset: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    alignItems: "center",
    justifyContent: "center",
    ...tileShadow(),
  },
  presetOn: {
    borderColor: colors.cyan,
    backgroundColor: colors.cyan,
  },
  presetLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
  },
  presetLabelOn: { color: "#04140f" },
  fieldLabel: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 8,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceFrost,
    color: colors.text,
    fontSize: 18,
    paddingHorizontal: 14,
  },
  error: {
    color: colors.danger ?? "#EF4444",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 12,
  },
  confirm: {
    marginTop: 24,
    backgroundColor: colors.cyan,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBusy: { opacity: 0.7 },
  confirmLabel: {
    color: "#04140f",
    fontSize: 16,
    fontWeight: "700",
  },
});
