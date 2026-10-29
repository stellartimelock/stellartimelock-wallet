import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "@/src/components/Toast";
import { TxReceiptBanner } from "@/src/components/TxReceiptBanner";
import { SessionProvider } from "@/src/state/session";
import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { colors } from "@/src/theme";
import { GradleBuildSplash } from "@/src/easter-eggs/GradleBuildSplash";
import { UpdateBootstrap } from "@/src/updates/UpdateBootstrap";
import { useGradleEasterEgg } from "@/src/easter-eggs/gradle-easter-egg";
import { installConsoleFilters } from "@/src/utils/console-filters";
import { initFirebase } from "@/src/analytics/firebase";
import { installIdleLock } from "@/src/security/session-keystore";
import { BiometricGate } from "@/src/security/BiometricGate";
import {
  initializeBilling,
  listenForSubscriptionUpdates,
} from "@/src/tiers/billing";

// Install console filters BEFORE any provider mounts.
installConsoleFilters();

// Boot Firebase Analytics (no-op facade) as early as possible.
initFirebase();

// Install the AppState listener that auto-locks the session-keystore.
installIdleLock();

// Keep the native splash visible from cold start until icon fonts register.
SplashScreen.preventAutoHideAsync();

// Splash minimum-visible time — shortened to reduce white flash between
// native splash hide and first content.
const SPLASH_MIN_VISIBLE_MS = 400;
const _mountedAt = Date.now();

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  // Gradle build easter egg — fake terminal build sequence on launch.
  // Gated by `useGradleEasterEgg()` which reads the persisted flag from
  // AsyncStorage.
  const gradleActive = useGradleEasterEgg();
  const [showGradleSplash, setShowGradleSplash] = useState(gradleActive);

  useEffect(() => {
    void initializeBilling();
    return listenForSubscriptionUpdates();
  }, []);

  useEffect(() => {
    if (loaded || error) {
      const elapsed = Date.now() - _mountedAt;
      const wait = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
      const t = setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, wait);
      // Safety timeout: force-unmount gradle overlay after 7s even if
      // its internal animation somehow fails to fire onComplete.
      const t2 = setTimeout(() => setShowGradleSplash(false), wait + 7000);
      return () => {
        clearTimeout(t);
        clearTimeout(t2);
      };
    }
  }, [loaded, error]);

  // If the CDN is unreachable, fall through on error — icons will tofu
  // but the app still boots.
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <SafeAreaProvider>
        <KeyboardProvider>
          <SessionProvider>
            <ToastProvider>
              <BiometricGate surface="wallet">
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.background },
                    animation: "fade",
                  }}
                />
                <TxReceiptBanner />
                <UpdateBootstrap />
              </BiometricGate>
            </ToastProvider>
          </SessionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
      <GradleBuildSplash
        visible={showGradleSplash}
        onComplete={() => setShowGradleSplash(false)}
      />
    </GestureHandlerRootView>
  );
}
