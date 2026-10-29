// Workaround: tabs snap back to initialRouteName after Stack pop — replace to lastMainTabPath instead.

import {
  router,
  useFocusEffect,
  useNavigation,
} from "expo-router";
import { useCallback, useEffect } from "react";
import { BackHandler } from "react-native";

let lastMainTabPath: string = "/(tabs)/wallet";

const VALID_TABS = new Set<string>([
  "/(tabs)/wallet",
  "/(tabs)/dashboard",
]);

export function getLastMainTab(): string {
  return lastMainTabPath;
}

export function useTrackTab(path: string) {
  useFocusEffect(
    useCallback(() => {
      if (VALID_TABS.has(path)) {
        lastMainTabPath = path;
      }
    }, [path]),
  );
}

export function useTabReturn(): { goBackToTab: () => void } {
  const navigation = useNavigation();

  const goBackToTab = useCallback(() => {
    const target = lastMainTabPath;
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(target as never);
    }
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goBackToTab();
      return true;
    });
    return () => sub.remove();
  }, [goBackToTab]);

  useEffect(() => {
    // @ts-expect-error React Navigation types not exposed via expo-router
    const unsub = navigation.addListener?.("beforeRemove", (e: unknown) => {
      // Only rewrite OS back POP/GO_BACK — allow programmatic navigation through.
      const evt = e as {
        data?: { action?: { type?: string } };
        preventDefault: () => void;
      };
      if (evt?.data?.action?.type === "POP" || evt?.data?.action?.type === "GO_BACK") {
        evt.preventDefault();
        router.replace(lastMainTabPath as never);
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [navigation]);

  return { goBackToTab };
}
