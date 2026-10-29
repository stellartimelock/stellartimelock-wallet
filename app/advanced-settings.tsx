// Advanced Settings — Soroban RPC overrides.
// Vault type selection and multi-asset live on the New Vault screen.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/src/components/Button";
import { Card } from "@/src/components/Card";
import { useToast } from "@/src/components/Toast";
import { useTabReturn } from "@/src/navigation/useTabReturn";
import { colors, radii, spacing, typography } from "@/src/theme";
import {
  hydrateRpcOverride,
  isHttpsRpcUrl,
  setRpcOverride,
} from "@/src/wallet/advanced-settings-prefs";
import {
  getAdvancedDeployment,
  getAdvancedNetworkName,
} from "@/src/wallet/advanced-vaults";

export default function AdvancedSettings() {
  useTabReturn();
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [rpcDraft, setRpcDraft] = useState("");
  const [savingRpc, setSavingRpc] = useState(false);

  const deployment = getAdvancedDeployment();
  const networkName = getAdvancedNetworkName();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rpc = await hydrateRpcOverride();
      setRpcDraft(rpc ?? "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveRpc = useCallback(async () => {
    setSavingRpc(true);
    try {
      const trimmed = rpcDraft.trim();
      if (trimmed && !isHttpsRpcUrl(trimmed)) {
        toast.show("RPC URL must be an https:// address with no password in the URL.", "error");
        return;
      }
      await setRpcOverride(trimmed || null);
      toast.show(
        trimmed ? "RPC override saved." : "RPC override cleared.",
        "success",
      );
    } finally {
      setSavingRpc(false);
    }
  }, [rpcDraft, toast]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="advanced-settings-screen">
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/settings")
          }
          style={styles.headerBack}
          testID="advanced-settings-back"
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Advanced Settings
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.teal} style={{ marginTop: spacing.lg }} />
        ) : (
          <>
            <Text style={styles.section}>SOROBAN RPC OVERRIDE</Text>
            <Card padded>
              <Text style={styles.label}>DEFAULT ({networkName.toUpperCase()})</Text>
              <Text style={styles.mono} selectable>
                {deployment.rpcUrl}
              </Text>
              <View style={{ height: spacing.sm }} />
              <Text style={styles.label}>CUSTOM RPC URL</Text>
              <TextInput
                testID="advanced-settings-rpc-input"
                value={rpcDraft}
                onChangeText={setRpcDraft}
                placeholder="https://…"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <View style={{ height: spacing.sm }} />
              <Button
                testID="advanced-settings-rpc-save"
                label={savingRpc ? "Saving…" : "Save RPC override"}
                icon="save"
                variant="secondary"
                onPress={onSaveRpc}
                disabled={savingRpc}
                loading={savingRpc}
              />
            </Card>

            <Text style={styles.section}>DIAGNOSTICS</Text>
            <Card padded>
              <Button
                testID="advanced-settings-open-diagnostics"
                label="Open Diagnostics"
                icon="terminal"
                variant="ghost"
                onPress={() => router.push("/diagnostics")}
              />
            </Card>

            <Text style={styles.section}>ABOUT</Text>
            <Card padded>
              <Button
                testID="advanced-settings-about-vaults"
                label="What is a vault?"
                icon="info"
                variant="ghost"
                onPress={() => router.push("/vault/about")}
              />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    gap: spacing.sm,
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
    ...typography.heading,
  },
  body: { padding: spacing.md, paddingBottom: spacing.xxl },
  section: {
    color: colors.textTertiary,
    fontSize: 11,
    ...typography.label,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  mono: {
    color: colors.teal,
    fontSize: 11,
    marginTop: 6,
    ...typography.mono,
  },
  label: {
    color: colors.textTertiary,
    fontSize: 10,
    ...typography.label,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 13,
  },
});
