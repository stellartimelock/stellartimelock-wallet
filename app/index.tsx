// Auth gate — immediate redirect, no splash screen.
//
// Routing is disk-authoritative (loadBook + browse-mode + tour prefs run in
// parallel so there are no serial SecureStore/AsyncStorage waits):
//   • wallet entries on disk  → /(tabs)/wallet
//   • browse mode (no seed)   → /(tabs)/wallet
//   • returning, tour chosen  → /wallet-setup
//   • first-run, value-prop pending → /welcome
//   • first-run, tour pending → /onboarding-choice
//   • fallback                → /wallet-setup

import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";

import { useSession } from "@/src/state/session";
import { colors } from "@/src/theme";
import { loadBook } from "@/src/wallet/wallet-book";
import { isBrowseMode } from "@/src/state/browse-mode";
import {
  isTourChoicePending,
  isValuePropPending,
} from "@/src/onboarding/guided-tour";

export default function Index() {
  const router = useRouter();
  const { ready } = useSession();
  const redirected = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (redirected.current) return;
    redirected.current = true;

    void (async () => {
      const [book, browsing, tourPending, valuePropPending] = await Promise.all([
        loadBook(),
        isBrowseMode(),
        isTourChoicePending(),
        isValuePropPending(),
      ]);

      if (book.entries.length > 0) {
        router.replace("/(tabs)/wallet");
        return;
      }
      if (browsing) {
        router.replace("/(tabs)/wallet");
        return;
      }
      if (!tourPending) {
        router.replace("/wallet-setup");
        return;
      }
      if (valuePropPending) {
        router.replace("/welcome" as never);
        return;
      }
      router.replace("/onboarding-choice" as never);
    })();
  }, [ready, router]);

  return <View style={styles.root} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
