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

import { useRouter, useFocusEffect } from "expo-router";
import React, { useCallback } from "react";
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

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      let cancelled = false;
      void (async () => {
        const [book, browsing, tourPending, valuePropPending] = await Promise.all([
          loadBook(),
          isBrowseMode(),
          isTourChoicePending(),
          isValuePropPending(),
        ]);
        if (cancelled) return;

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
      return () => {
        cancelled = true;
      };
    }, [ready, router]),
  );

  return <View style={styles.root} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
