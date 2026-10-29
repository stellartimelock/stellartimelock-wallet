// Wallet bottom tab bar.
//
// No visible tabs — `wallet.tsx` remains the initial route and is
// reachable via navigation/deep links, but is hidden from the tab bar
// (`href: null`). `dashboard.tsx` (retired standalone vaults tab) stays
// registered the same way so `/(tabs)/dashboard` deep links keep
// resolving.

import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";

import { colors } from "@/src/theme";

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="wallet"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.barHidden,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {/* Main wallet surface — hidden from the tab bar. */}
      <Tabs.Screen
        name="wallet"
        options={{
          href: null,
        }}
      />

      {/* Retired standalone vaults tab — kept registered so deep
          links to `/(tabs)/dashboard` keep resolving, hidden from
          the tab bar. */}
      <Tabs.Screen
        name="dashboard"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barHidden: {
    display: "none",
  },
});
