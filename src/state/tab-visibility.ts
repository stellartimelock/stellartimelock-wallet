// Crypto tab visibility + usage-onboarding prefs (AsyncStorage + sync cache).

import { useCallback, useEffect, useState } from "react";

import { storage } from "@/src/utils/storage";

const KEY_CRYPTO_TAB_ENABLED = "stl.tab.cryptoEnabled";
const KEY_USAGE_ONBOARDING_DONE = "stl.onboarding.usageChoice.done";
const KEY_DEFAULT_SCREEN = "stl.tab.defaultScreen";

/** Recognised default-screen values. The standalone wallet app has a
 *  single tab (`wallet` = the vault dashboard); "home"/"notebook" are
 *  kept only for backward-compat with legacy persisted values from the
 *  unified app. */
export type DefaultScreen = "home" | "notebook" | "wallet";
const DEFAULT_SCREENS: DefaultScreen[] = ["home", "notebook", "wallet"];
const DEFAULT_DEFAULT_SCREEN: DefaultScreen = "wallet";

/** Default when nothing is persisted yet. */
const DEFAULT_CRYPTO_TAB_ENABLED = true;

let cachedCryptoEnabled: boolean = DEFAULT_CRYPTO_TAB_ENABLED;
let cacheHydrated = false;
const subscribers = new Set<(v: boolean) => void>();

function notify(v: boolean) {
  cachedCryptoEnabled = v;
  for (const cb of subscribers) cb(v);
}

async function hydrateCache(): Promise<boolean> {
  const raw = await storage.getItem<boolean>(
    KEY_CRYPTO_TAB_ENABLED,
    DEFAULT_CRYPTO_TAB_ENABLED,
  );
  const next = typeof raw === "boolean" ? raw : DEFAULT_CRYPTO_TAB_ENABLED;
  cachedCryptoEnabled = next;
  cacheHydrated = true;
  return next;
}

void hydrateCache().catch(() => {
  /* leave default on failure */
});

export function getCryptoTabEnabledSync(): boolean {
  return cachedCryptoEnabled;
}

export async function setCryptoTabEnabled(next: boolean): Promise<void> {
  await storage.setItem<boolean>(KEY_CRYPTO_TAB_ENABLED, next);
  notify(next);
}

export function useCryptoTabEnabled(): [boolean, (next: boolean) => Promise<void>] {
  const [enabled, setLocal] = useState<boolean>(cachedCryptoEnabled);

  useEffect(() => {
    let alive = true;
    if (!cacheHydrated) {
      void hydrateCache().then((v) => {
        if (alive) setLocal(v);
      });
    }
    const cb = (v: boolean) => {
      if (alive) setLocal(v);
    };
    subscribers.add(cb);
    return () => {
      alive = false;
      subscribers.delete(cb);
    };
  }, []);

  const set = useCallback(async (next: boolean) => {
    await setCryptoTabEnabled(next);
  }, []);

  return [enabled, set];
}

export async function isUsageOnboardingComplete(): Promise<boolean> {
  const raw = await storage.getItem<boolean>(KEY_USAGE_ONBOARDING_DONE, false);
  return raw === true;
}

/** Mark the chooser as seen.  Does NOT itself set the crypto flag —
 *  the caller passes a boolean to `setCryptoTabEnabled` first. */
export async function markUsageOnboardingComplete(): Promise<void> {
  await storage.setItem<boolean>(KEY_USAGE_ONBOARDING_DONE, true);
}

export async function getDefaultScreen(): Promise<DefaultScreen> {
  const raw = await storage.getItem<string>(
    KEY_DEFAULT_SCREEN,
    DEFAULT_DEFAULT_SCREEN,
  );
  return (DEFAULT_SCREENS as string[]).includes(raw)
    ? (raw as DefaultScreen)
    : DEFAULT_DEFAULT_SCREEN;
}

export async function setDefaultScreen(next: DefaultScreen): Promise<void> {
  if (!(DEFAULT_SCREENS as string[]).includes(next)) return;
  await storage.setItem<string>(KEY_DEFAULT_SCREEN, next);
}

/** React hook mirroring `useCryptoTabEnabled` — returns the value +
 *  an async setter. Hydrates once on first mount. */
export function useDefaultScreen(): [
  DefaultScreen,
  (next: DefaultScreen) => Promise<void>,
] {
  const [screen, setLocal] = useState<DefaultScreen>(DEFAULT_DEFAULT_SCREEN);
  useEffect(() => {
    let alive = true;
    void getDefaultScreen().then((v) => {
      if (alive) setLocal(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const set = useCallback(async (next: DefaultScreen) => {
    setLocal(next);
    await setDefaultScreen(next);
  }, []);
  return [screen, set];
}
