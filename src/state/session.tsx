import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { storage } from "@/src/utils/storage";
import { CURRENCY_KEY } from "@/src/state/currency-pref";
import {
  StellarKeypair,
  clearKeypair,
  loadPersistedKeypair,
} from "@/src/wallet/stellar";
import {
  loadBook,
  loadActiveKeypair,
  addBurnerWallet as bookAddBurner,
  addImportedWallet as bookAddImported,
  setActiveWallet as bookSetActive,
  renameWallet as bookRename,
  removeWallet as bookRemove,
  clearBook,
  type WalletMeta,
} from "@/src/wallet/wallet-book";

import type { IVaultClient } from "@/src/vault/contract";
import { setActiveVaultClient } from "@/src/api/client";
import { POLL_MIN_INTERVAL_MS } from "@/src/utils/polling";
import { lazyVaultClient } from "@/src/api/lazy-vault-client";
import {
  type StellarNetwork,
  setActiveNetwork,
  deploymentFor,
} from "@/src/wallet/contract-config";
import { isPlayReleaseBuild, isVerifyTestnetBuild } from "@/src/wallet/play-network";
import {
  clearBrowseMode,
  enableBrowseMode as persistBrowseMode,
  isBrowseMode,
} from "@/src/state/browse-mode";
import { fetchXlmDexPrice } from "@/src/wallet/horizon";
import { VAULT_SESSION_STALE_MS } from "@/src/vault/vault-session-cache";
import {
  getWalletSeed,
  isUnlocked,
  setWalletSeed,
  subscribeSessionLock,
} from "@/src/security/session-keystore";

const NETWORK_KEY = "xlm_vault_network";

export type Currency = "USD" | "EUR" | "XLM";

const PRICE_CACHE_KEY = "xlm_vault_market_price_cache";
/** Discard persisted market rates older than this — force a fresh fetch. */
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;

/** Placeholder rates until a live or fresh-cache price is available. Never shown as $0.12. */
const EMPTY_RATES: Record<Currency, number> = {
  XLM: 1,
  USD: 0,
  EUR: 0,
};

const SYMBOLS: Record<Currency, string> = {
  XLM: "XLM",
  USD: "$",
  EUR: "€",
};

/** Poll cadence — same 60s floor as vault session staleness / app polls. */
const PRICE_REFRESH_MS = POLL_MIN_INTERVAL_MS;
/** Don't hit Horizon for price more often than vaults refresh. */
const PRICE_STALE_MS = VAULT_SESSION_STALE_MS;
/** After a failed DEX fetch, wait before retrying (not the normal 60s). */
const PRICE_RETRY_MS = 2 * 60 * 1000;

export type PriceSource = "loading" | "live" | "cache" | "unavailable";

interface CachedRates {
  usd: number;
  eur: number;
  last_updated_at: number;
  fetched_at: number;
}

function isFreshCache(cached: CachedRates | null | undefined): cached is CachedRates {
  if (!cached || !(cached.usd > 0) || !(cached.eur > 0)) return false;
  if (!Number.isFinite(cached.fetched_at)) return false;
  return Date.now() - cached.fetched_at <= PRICE_CACHE_TTL_MS;
}

interface SessionState {
  ready: boolean;
  wallet: StellarKeypair | null;
  setWallet: (kp: StellarKeypair | null) => void;
  disconnect: () => Promise<void>;

  /** True when the user chose "Browse without seed" and has no wallet yet. */
  browseMode: boolean;
  /** Persist browse mode and mark the session as browsing. */
  enterBrowseMode: () => Promise<void>;

  wallets: WalletMeta[];
  activeWalletId: string | null;
  /** Reload wallet-book metadata into session state (e.g. after backup import). */
  refreshWallets: () => Promise<void>;
  addBurnerWallet: (label: string) => Promise<WalletMeta>;
  addImportedWallet: (
    label: string,
    secret: string,
    options?: { makeActive?: boolean },
  ) => Promise<{ meta: WalletMeta; wasAlreadyImported: boolean; autoMatchedLabel: boolean }>;
  switchWallet: (id: string) => Promise<void>;
  renameWallet: (id: string, label: string) => Promise<string>;
  removeWallet: (id: string) => Promise<void>;

  currency: Currency;
  setCurrency: (c: Currency) => Promise<void>;
  formatXlm: (xlm: number) => string;
  formatFiat: (xlm: number) => string;

  rates: Record<Currency, number>;
  ratesUpdatedAt: number | null;
  /** Where the current fiat rate came from — drives wallet cache/live indicator. */
  priceSource: PriceSource;
  refreshRates: () => Promise<void>;
  /**
   * Wallet tab focus gate for DEX price polling. Only the focused wallet
   * surface should enable this so Horizon isn't queried from other screens.
   */
  setPricePollingActive: (active: boolean) => void;

  network: StellarNetwork;
  setNetwork: (n: StellarNetwork) => Promise<void>;

  client: IVaultClient;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [wallet, setWalletState] = useState<StellarKeypair | null>(null);
  const walletRef = useRef<StellarKeypair | null>(null);
  useEffect(() => {
    walletRef.current = wallet;
  }, [wallet]);

  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [browseMode, setBrowseMode] = useState(false);
  const refreshBook = useCallback(async () => {
    const book = await loadBook();
    setWallets(book.entries);
    setActiveWalletId(book.activeId);
  }, []);

  const endBrowseMode = useCallback(async () => {
    await clearBrowseMode();
    setBrowseMode(false);
  }, []);

  const enterBrowseMode = useCallback(async () => {
    await persistBrowseMode();
    setBrowseMode(true);
  }, []);

  const [currency, setCurrencyState] = useState<Currency>("USD");
  const [network, setNetworkState] = useState<StellarNetwork>("mainnet");
  const [rates, setRates] = useState<Record<Currency, number>>(EMPTY_RATES);
  const [ratesUpdatedAt, setRatesUpdatedAt] = useState<number | null>(null);
  const [priceSource, setPriceSource] = useState<PriceSource>("loading");
  const inflightRef = useRef<Promise<void> | null>(null);
  const lastPriceFetchAtRef = useRef<number>(0);
  const nextPriceAllowedAtRef = useRef<number>(0);
  const appActiveRef = useRef<boolean>(AppState.currentState === "active");
  const walletFocusedRef = useRef<boolean>(false);
  const cachedRatesRef = useRef<CachedRates | null>(null);
  const ratesRef = useRef<Record<Currency, number>>(EMPTY_RATES);
  useEffect(() => {
    ratesRef.current = rates;
  }, [rates]);

  useEffect(() => {
    // Idle lock used to leave secretSeed in this React state, so Send and
    // vault screens could still sign. Drop it until a fingerprint grant.
    return subscribeSessionLock(() => {
      if (!isUnlocked()) {
        setWalletState((current) => {
          if (!current?.secretSeed) return current;
          return { publicKey: current.publicKey, secretSeed: "" };
        });
        return;
      }
      void loadActiveKeypair().then((kp) => {
        if (kp?.secretSeed) setWalletState(kp);
      });
    });
  }, []);

  useEffect(() => {
    void import("@/src/wallet/advanced-settings-prefs").then((m) =>
      m.hydrateRpcOverride().catch(() => null),
    );
    void import("@/src/tiers/tier-config").then((m) =>
      m.hydrateTier().catch(() => null),
    );
  }, []);

  useEffect(() => {
    (async () => {
      const [book, cur, net, cachedRates, browsing] = await Promise.all([
        loadBook(),
        storage.getItem<Currency>(CURRENCY_KEY, "USD"),
        storage.getItem<StellarNetwork>(NETWORK_KEY, "mainnet"),
        storage.getItem<CachedRates | null>(PRICE_CACHE_KEY, null),
        isBrowseMode(),
      ]);
      setWallets(book.entries);
      setActiveWalletId(book.activeId);
      let activeKp: StellarKeypair | null = null;
      if (book.activeId) {
        activeKp = await loadActiveKeypair();
      }
      if (!activeKp) {
        activeKp = await loadPersistedKeypair();
      }
      if (activeKp) {
        setWalletState(activeKp);
        if (activeKp.secretSeed && book.activeId && !(await getWalletSeed(book.activeId))) {
          await setWalletSeed(book.activeId, activeKp.secretSeed);
        }
        // Real wallet wins — drop stale browse flag.
        if (browsing) await clearBrowseMode();
        setBrowseMode(false);
      } else {
        setBrowseMode(browsing);
      }
      if (cur === "USD" || cur === "EUR" || cur === "XLM") setCurrencyState(cur);
      try {
        void net;
        // Release builds start on mainnet. The testnet verification build
        // (com.stellartimelock.verify) starts on testnet and stays there.
        const candidate: StellarNetwork = isVerifyTestnetBuild() ? "testnet" : "mainnet";
        deploymentFor(candidate);
        setActiveNetwork(candidate);
        setNetworkState(candidate);
        await storage.setItem<StellarNetwork>(NETWORK_KEY, candidate);
      } catch {
        const fallback: StellarNetwork = "mainnet";
        try {
          deploymentFor(fallback);
          setActiveNetwork(fallback);
          setNetworkState(fallback);
        } catch {
          if (!isPlayReleaseBuild()) {
            setActiveNetwork("testnet");
            setNetworkState("testnet");
          }
        }
        await storage.setItem<StellarNetwork>(NETWORK_KEY, "mainnet");
      }
      if (isFreshCache(cachedRates)) {
        cachedRatesRef.current = cachedRates;
        setRates({ XLM: 1, USD: cachedRates.usd, EUR: cachedRates.eur });
        setRatesUpdatedAt(cachedRates.fetched_at);
        setPriceSource("cache");
      } else {
        if (cachedRates && cachedRates.usd > 0) {
          // Keep stale snapshot for DEX failure fallback even past TTL.
          cachedRatesRef.current = cachedRates;
        }
        setRates(EMPTY_RATES);
        setRatesUpdatedAt(null);
        setPriceSource("loading");
      }
      setReady(true);
    })();
  }, []);

  const setWallet = useCallback((kp: StellarKeypair | null) => {
    setWalletState(kp);
    if (kp) {
      void endBrowseMode();
    }
  }, [endBrowseMode]);

  const disconnect = useCallback(async () => {
    const publicKey = walletRef.current?.publicKey;
    if (publicKey) {
      try {
        const { clearCachedVaults } = await import("@/src/api/vault-cache");
        await clearCachedVaults(publicKey);
      } catch {
        // ignore
      }
      try {
        const { invalidateVaultSessionCache } = await import(
          "@/src/vault/vault-session-cache"
        );
        invalidateVaultSessionCache(publicKey);
      } catch {
        // ignore
      }
      try {
        const { clearMemoDiscoveryScanCache } = await import(
          "@/src/vault/memo-discovery"
        );
        clearMemoDiscoveryScanCache(publicKey);
      } catch {
        // ignore
      }
    }
    try {
      await clearKeypair();
    } catch {
      // ignore
    }
    try {
      await clearBook();
    } catch {
      // ignore
    }
    try {
      await endBrowseMode();
    } catch {
      // ignore
    }
    try {
      const { clearKeyManagerSession } = await import("@/src/security/key-manager-store");
      clearKeyManagerSession();
    } catch {
      // ignore
    }
    setWallets([]);
    setActiveWalletId(null);
    setWalletState(null);
    setBrowseMode(false);
  }, [endBrowseMode]);

  const addBurnerWallet = useCallback(async (label: string) => {
    const { meta, keypair } = await bookAddBurner(label, true);
    await refreshBook();
    setWalletState(keypair);
    await endBrowseMode();
    return meta;
  }, [refreshBook, endBrowseMode]);

  const addImportedWallet = useCallback(async (
    label: string,
    secret: string,
    options?: { makeActive?: boolean },
  ) => {
    const makeActive = options?.makeActive !== false;
    const { meta, keypair, wasAlreadyImported, autoMatchedLabel } = await bookAddImported(
      label,
      secret,
      makeActive,
    );
    await refreshBook();
    if (makeActive) {
      setWalletState(keypair);
      await endBrowseMode();
    }
    return { meta, wasAlreadyImported, autoMatchedLabel };
  }, [refreshBook, endBrowseMode]);

  const switchWallet = useCallback(async (id: string) => {
    const kp = await bookSetActive(id);
    if (!kp) {
      throw new Error("Couldn't unlock that wallet with biometrics.");
    }
    setWalletState(kp);
    await refreshBook();
  }, [refreshBook]);

  const renameWallet = useCallback(async (id: string, label: string) => {
    const finalLabel = await bookRename(id, label);
    await refreshBook();
    return finalLabel;
  }, [refreshBook]);

  const removeWallet = useCallback(async (id: string) => {
    const wasActive = activeWalletId === id;
    await bookRemove(id);
    await refreshBook();
    if (wasActive) {
      const newKp = await loadActiveKeypair();
      setWalletState(newKp);
    }
  }, [refreshBook, activeWalletId]);

  const setCurrency = useCallback(async (c: Currency) => {
    setCurrencyState(c);
    await storage.setItem(CURRENCY_KEY, c);
  }, []);

  const setNetwork = useCallback(async (n: StellarNetwork) => {
    if (isVerifyTestnetBuild()) {
      if (n !== "testnet") return;
    } else if (isPlayReleaseBuild() && n !== "mainnet") {
      return;
    }
    setActiveNetwork(n);
    setNetworkState(n);
    await storage.setItem<StellarNetwork>(NETWORK_KEY, n);
  }, []);

  const applyCachedRatesFallback = useCallback(async () => {
    let cached = cachedRatesRef.current;
    if (!cached || !(cached.usd > 0)) {
      try {
        cached = await storage.getItem<CachedRates | null>(PRICE_CACHE_KEY, null);
      } catch {
        cached = null;
      }
    }
    if (cached && cached.usd > 0) {
      cachedRatesRef.current = cached;
      const eur = cached.eur > 0 ? cached.eur : 0;
      setRates({ XLM: 1, USD: cached.usd, EUR: eur });
      setRatesUpdatedAt(cached.fetched_at);
      setPriceSource("cache");
      return true;
    }
    setRates(EMPTY_RATES);
    setRatesUpdatedAt(null);
    setPriceSource("unavailable");
    return false;
  }, []);

  const refreshRates = useCallback(async (opts?: { force?: boolean }) => {
    if (!appActiveRef.current || !walletFocusedRef.current) return;
    const now = Date.now();
    if (!opts?.force) {
      if (now < nextPriceAllowedAtRef.current) return;
      if (
        lastPriceFetchAtRef.current > 0 &&
        now - lastPriceFetchAtRef.current < PRICE_STALE_MS
      ) {
        return;
      }
    }
    if (inflightRef.current) return inflightRef.current;
    const p = (async () => {
      try {
        const r = await fetchXlmDexPrice();
        const usd = r.usd;
        // Prefer live EURC mid; else preserve prior EUR/USD cross from cache/state.
        let eur = r.eur != null && r.eur > 0 ? r.eur : 0;
        if (!(eur > 0)) {
          const prev = ratesRef.current;
          const cached = cachedRatesRef.current;
          if (prev.USD > 0 && prev.EUR > 0) {
            eur = usd * (prev.EUR / prev.USD);
          } else if (cached && cached.usd > 0 && cached.eur > 0) {
            eur = usd * (cached.eur / cached.usd);
          }
        }
        if (!(usd > 0)) {
          nextPriceAllowedAtRef.current = Date.now() + PRICE_RETRY_MS;
          await applyCachedRatesFallback();
          return;
        }
        const fetchedAt = r.fetchedAt;
        lastPriceFetchAtRef.current = fetchedAt;
        nextPriceAllowedAtRef.current = 0;
        setRates({ XLM: 1, USD: usd, EUR: eur > 0 ? eur : 0 });
        setRatesUpdatedAt(fetchedAt);
        setPriceSource("live");
        // Only persist when both sides are usable so isFreshCache stays valid.
        if (eur > 0) {
          const snap: CachedRates = {
            usd,
            eur,
            last_updated_at: Math.floor(fetchedAt / 1000),
            fetched_at: fetchedAt,
          };
          cachedRatesRef.current = snap;
          await storage.setItem<CachedRates>(PRICE_CACHE_KEY, snap);
        }
      } catch {
        nextPriceAllowedAtRef.current = Date.now() + PRICE_RETRY_MS;
        await applyCachedRatesFallback();
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = p;
    return p;
  }, [applyCachedRatesFallback]);

  const setPricePollingActive = useCallback(
    (active: boolean) => {
      walletFocusedRef.current = active;
      if (active && appActiveRef.current) {
        void refreshRates();
      }
    },
    [refreshRates],
  );

  // App foreground/background — never poll Horizon prices while backgrounded.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const active = next === "active";
      appActiveRef.current = active;
      if (active && walletFocusedRef.current) {
        void refreshRates();
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refreshRates]);

  // Tick every 60s, but refreshRates itself enforces focus + staleness + backoff.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      void refreshRates();
    }, PRICE_REFRESH_MS);
    return () => clearInterval(id);
  }, [ready, refreshRates]);

  const client: IVaultClient = lazyVaultClient;
  useEffect(() => {
    setActiveVaultClient(client);
  }, [client]);

  const formatXlm = useCallback((xlm: number) => {
    const n = Number.isFinite(xlm) ? xlm : 0;
    return `${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    })} XLM`;
  }, []);

  const formatFiat = useCallback(
    (xlm: number) => {
      const n = Number.isFinite(xlm) ? xlm : 0;
      if (currency === "XLM") return formatXlm(n);
      if (priceSource === "unavailable") return "Price unavailable";
      if (
        priceSource === "loading" ||
        !(rates[currency] > 0)
      ) {
        return "—";
      }
      const v = n * rates[currency];
      return `${SYMBOLS[currency]}${v.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    },
    [currency, formatXlm, rates, priceSource],
  );

  const value = useMemo<SessionState>(
    () => ({
      ready,
      wallet,
      setWallet,
      disconnect,
      browseMode,
      enterBrowseMode,
      wallets,
      activeWalletId,
      refreshWallets: refreshBook,
      addBurnerWallet,
      addImportedWallet,
      switchWallet,
      renameWallet,
      removeWallet,
      currency,
      setCurrency,
      formatXlm,
      formatFiat,
      rates,
      ratesUpdatedAt,
      priceSource,
      refreshRates,
      setPricePollingActive,
      network,
      setNetwork,
      client,
    }),
    [
      ready,
      wallet,
      setWallet,
      disconnect,
      browseMode,
      enterBrowseMode,
      wallets,
      activeWalletId,
      refreshBook,
      addBurnerWallet,
      addImportedWallet,
      switchWallet,
      renameWallet,
      removeWallet,
      currency,
      setCurrency,
      formatXlm,
      formatFiat,
      rates,
      ratesUpdatedAt,
      priceSource,
      refreshRates,
      setPricePollingActive,
      network,
      setNetwork,
      client,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within SessionProvider");
  return v;
}