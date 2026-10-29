// Diagnostics — network, RPC, and contract reference for support / debugging.
// Read-only aside from the optional Soroban RPC override. No secrets.

import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
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
import { useToast } from "@/src/components/Toast";
import { useTabReturn } from "@/src/navigation/useTabReturn";
import { colors, radii, spacing, tileShadow, typography } from "@/src/theme";
import {
  hydrateRpcOverride,
  isHttpsRpcUrl,
  setRpcOverride,
} from "@/src/wallet/advanced-settings-prefs";
import {
  getAdvancedDeployment,
  getAdvancedNetworkName,
} from "@/src/wallet/advanced-vaults";
import { getActiveDeployment } from "@/src/wallet/contract-config";
import { MULTI_ASSET_MAINNET_CONTRACT_ID } from "@/src/wallet/multi-asset-beta/contract-config";
import { getCurrentRpcUrl } from "@/src/wallet/rpc-failover";

export default function Diagnostics() {
  useTabReturn();
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [rpcDraft, setRpcDraft] = useState("");
  const [savingRpc, setSavingRpc] = useState(false);
  const [activeRpc, setActiveRpc] = useState("");

  const xlmDep = getActiveDeployment();
  const advancedDep = getAdvancedDeployment();
  const advancedNetwork = getAdvancedNetworkName();

  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    null;

  const refreshActiveRpc = useCallback(() => {
    setActiveRpc(getCurrentRpcUrl());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rpc = await hydrateRpcOverride();
      setRpcDraft(rpc ?? "");
      refreshActiveRpc();
    } finally {
      setLoading(false);
    }
  }, [refreshActiveRpc]);

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
      refreshActiveRpc();
      toast.show(
        trimmed ? "RPC override saved." : "RPC override cleared.",
        "success",
      );
    } finally {
      setSavingRpc(false);
    }
  }, [rpcDraft, toast, refreshActiveRpc]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="diagnostics-screen">
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/settings")
          }
          style={styles.headerBack}
          testID="diagnostics-back"
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Diagnostics
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator
            color={colors.cyan}
            style={{ marginTop: spacing.lg }}
          />
        ) : (
          <>
            <Text style={styles.section}>SOROBAN RPC</Text>
            <View style={styles.card}>
              <Text style={styles.label}>IN USE</Text>
              <Text style={styles.mono} selectable testID="diagnostics-rpc-active">
                {activeRpc || xlmDep.rpcUrl}
              </Text>
              <View style={{ height: spacing.md }} />
              <Text style={styles.label}>
                DEFAULT ({xlmDep.network.toUpperCase()})
              </Text>
              <Text style={styles.monoSecondary} selectable>
                {xlmDep.rpcUrl}
              </Text>
              <View style={{ height: spacing.md }} />
              <Text style={styles.label}>CUSTOM OVERRIDE</Text>
              <TextInput
                testID="diagnostics-rpc-input"
                value={rpcDraft}
                onChangeText={setRpcDraft}
                placeholder="https://rpc.ankr.com/stellar_soroban"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={styles.hint}>
                Leave blank to use the default. Override applies across vault
                RPC calls.
              </Text>
              <View style={{ height: spacing.sm }} />
              <Button
                testID="diagnostics-rpc-save"
                label={savingRpc ? "Saving…" : "Save RPC override"}
                icon="save"
                variant="secondary"
                onPress={onSaveRpc}
                disabled={savingRpc}
                loading={savingRpc}
              />
            </View>

            <Text style={styles.section}>NETWORK</Text>
            <View style={styles.card}>
              <Row label="Active network" value={xlmDep.network} />
              <Row
                label="Passphrase"
                value={xlmDep.networkPassphrase}
                mono
                testID="diagnostics-passphrase"
              />
              <Row
                label="Advanced vaults network"
                value={advancedNetwork}
              />
            </View>

            <Text style={styles.section}>CONTRACTS</Text>
            <View style={styles.card}>
              <Row
                label="XLM Vault"
                value={xlmDep.contractId}
                mono
                testID="diagnostics-contract-xlm"
              />
              <Row
                label="Multi-Asset Vault"
                value={MULTI_ASSET_MAINNET_CONTRACT_ID}
                mono
                testID="diagnostics-contract-multi"
              />
              <Row
                label="Advanced Vaults"
                value={advancedDep.contractId}
                mono
                testID="diagnostics-contract-advanced"
              />
            </View>

            {appVersion ? (
              <>
                <Text style={styles.section}>APP</Text>
                <View style={styles.card}>
                  <Row
                    label="Version"
                    value={appVersion}
                    testID="diagnostics-app-version"
                  />
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  mono,
  testID,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={mono ? styles.mono : styles.value}
        selectable
        testID={testID}
      >
        {value}
      </Text>
    </View>
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
    color: colors.textSecondary,
    fontSize: 11,
    ...typography.label,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  card: {
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
    ...tileShadow(),
  },
  row: {
    gap: 4,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 10,
    ...typography.label,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  mono: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    ...typography.mono,
  },
  monoSecondary: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    ...typography.mono,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
  },
  input: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 13,
  },
});
