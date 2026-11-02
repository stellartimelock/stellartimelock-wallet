// Visible label for the testnet verification build only
// (com.stellartimelock.verify, EXPO_PUBLIC_STL_VERIFY_TESTNET=1).
// Play and F-Droid builds render nothing.
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isVerifyTestnetBuild } from "@/src/wallet/play-network";

export function VerifyTestnetBanner() {
  const insets = useSafeAreaInsets();
  if (!isVerifyTestnetBuild()) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { top: Math.max(insets.top - 18, 0) }]}
      testID="verify-testnet-banner"
    >
      <Text style={styles.text}>TESTNET VERIFY BUILD</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "#C62828",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
    zIndex: 9999,
    elevation: 9999,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
