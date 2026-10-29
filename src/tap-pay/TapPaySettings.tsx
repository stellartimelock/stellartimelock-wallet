import { useCallback, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { Button } from "@/src/components/Button";
import { colors, radii, spacing } from "@/src/theme";

import { assessLimitSettings, DEFAULT_TAP_LIMITS } from "@/src/tap-pay/limits";
import { trimAmount } from "@/src/tap-pay/money";
import { loadTapPay, updateTapPay } from "@/src/tap-pay/history-device";
import { withLimits, withOtpPref } from "@/src/tap-pay/save";

export function TapPaySettings() {
  const [perTx, setPerTx] = useState(trimAmount(DEFAULT_TAP_LIMITS.perTxXlm));
  const [daily, setDaily] = useState(trimAmount(DEFAULT_TAP_LIMITS.dailyXlm));
  const [otp, setOtp] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    void loadTapPay().then((doc) => {
      if (!alive) return;
      setPerTx(trimAmount(doc.limits.perTxXlm));
      setDaily(trimAmount(doc.limits.dailyXlm));
      setOtp(doc.requireOtpForNewAddresses);
    });
    return () => {
      alive = false;
    };
  }, []));

  const save = useCallback(async () => {
    const checked = assessLimitSettings(perTx, daily);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateTapPay((doc) => withLimits(doc, {
        perTxXlm: checked.perTxXlm,
        dailyXlm: checked.dailyXlm,
      }, Date.now()));
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }, [daily, perTx]);

  const toggleOtp = useCallback(async (next: boolean) => {
    setOtp(next);
    try {
      await updateTapPay((doc) => withOtpPref(doc, next, Date.now()));
    } catch {
      setOtp(!next);
    }
  }, []);

  return (
    <View>
      <Text style={styles.section}>REQUEST OR PAY</Text>
      <Text style={styles.help}>
        Phone-to-phone XLM lives on the wallet home. A tap alone never sends.
        Fingerprint plus a second in-app confirm are both required.
      </Text>
      <View style={styles.otpRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.otpLabel}>Authenticator for new addresses</Text>
          <Text style={styles.help}>
            Optional. Uses a code from your in-app authenticator. Email codes
            are not sent from this wallet (no server).
          </Text>
        </View>
        <Switch
          value={otp}
          onValueChange={(v) => void toggleOtp(v)}
          testID="settings-tap-otp"
        />
      </View>
      <Text
        style={styles.limitsToggle}
        onPress={() => setLimitsOpen((v) => !v)}
        testID="settings-tap-limits-toggle"
      >
        {limitsOpen ? "Hide spending caps" : "Spending caps (optional)"}
      </Text>
      {limitsOpen ? (
        <View>
          <Text style={styles.help}>
            Caps are a reminder, not a second send button. New addresses over
            a cap can be allowed once after you check the full address.
          </Text>
          <Text style={styles.label}>Per payment (XLM)</Text>
          <TextInput
            value={perTx}
            onChangeText={setPerTx}
            keyboardType="decimal-pad"
            style={styles.input}
            testID="settings-tap-per-tx"
          />
          <Text style={styles.label}>Per day (XLM)</Text>
          <TextInput
            value={daily}
            onChangeText={setDaily}
            keyboardType="decimal-pad"
            style={styles.input}
            testID="settings-tap-daily"
          />
          {message ? <Text style={styles.help}>{message}</Text> : null}
          <Button label="Save caps" onPress={() => void save()} loading={saving} style={{ marginTop: spacing.sm }} testID="settings-tap-save-limits" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    color: colors.textTertiary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.2,
  },
  help: { color: colors.textSecondary, marginTop: spacing.sm, fontSize: 13, lineHeight: 18 },
  label: { color: colors.text, marginTop: spacing.md, fontSize: 14 },
  otpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  otpLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  limitsToggle: {
    color: colors.textTertiary,
    marginTop: spacing.lg,
    fontSize: 13,
    textDecorationLine: "underline",
  },
  input: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.input,
    padding: spacing.md,
    fontSize: 16,
  },
});
