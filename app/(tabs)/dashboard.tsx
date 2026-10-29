// Retired standalone Vaults tab — still registered in (tabs)/_layout so
// deep links to `/(tabs)/dashboard` keep resolving. Vault list UI is the
// same UnifiedVaultsList mounted on the Crypto tab (wallet.tsx).

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "@/src/state/session";
import { useTrackTab } from "@/src/navigation/useTabReturn";
import { BiometricGate } from "@/src/security/BiometricGate";
import { colors, spacing } from "@/src/theme";
import { UnifiedVaultsList } from "@/src/vault/UnifiedVaultsList";

import { styles } from "@/src/dashboard/styles";

export default function Dashboard() {
  useTrackTab("/(tabs)/dashboard");
  const router = useRouter();
  const { ready, wallet, browseMode } = useSession();

  useEffect(() => {
    if (!ready) return;
    // Allow browse-without-seed to stay in the app; only bounce when
    // there is neither a wallet nor an active browse session.
    if (!wallet && !browseMode) {
      router.replace("/");
    }
  }, [ready, wallet, browseMode, router]);

  if (!wallet && !browseMode) return null;

  return (
    <BiometricGate surface="vaults">
      <SafeAreaView edges={["top"]} style={styles.root} testID="dashboard-screen">
        <View style={styles.header}>
          <View style={styles.headerTextCol}>
            <Text style={styles.eyebrow}>STELLAR TIMELOCK</Text>
            <Text style={styles.headerTitle}>Vaults</Text>
            <Text style={styles.address}>
              {wallet
                ? "Time-locked contract vaults on Stellar Mainnet"
                : "Browse mode — add a seed to create or manage vaults"}
            </Text>
          </View>
          <View style={styles.headerIcons}>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: "/history",
                  params: { source: "vaults" },
                })
              }
              style={styles.headerIconBtn}
              testID="dashboard-open-history"
              accessibilityLabel="Vault history"
            >
              <Feather name="clock" size={18} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/settings")}
              style={styles.headerIconBtn}
              testID="dashboard-open-settings"
              accessibilityLabel="Settings"
            >
              <Feather name="settings" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: spacing.xxl }]}
          testID="dashboard-vault-list"
        >
          <UnifiedVaultsList />
        </ScrollView>
      </SafeAreaView>
    </BiometricGate>
  );
}
