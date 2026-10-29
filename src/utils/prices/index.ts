// Live spot-price client.
//
// Thin wrapper around GET /api/prices that:
//   * polls every 60 s while the component is mounted
//   * exposes the last-fetched timestamp so the UI can render a
//     "Updated 32s ago" caption
//   * surfaces `stale` (backend served last known good value because
//     the upstream provider is down) and `error` so consumers can
//     render an inline warning without blowing up
//
// The backend serves an `xlm_usd` field even for free-tier users;
// SOL price is present in the same payload but the UI gates its
// consumption behind the premium flag (see CurrencyConverter.tsx).

import { useCallback, useEffect, useRef, useState } from "react";

import { POLL_MIN_INTERVAL_MS } from "@/src/utils/polling";
import { fetchXlmDexPrice } from "@/src/wallet/horizon";
// Poll cadence.  Matches the backend cache TTL so we never fetch
// faster than the cache refreshes.  If both are 60 s we get one live
// upstream hit per minute total across all mounted consumers.
const POLL_INTERVAL_MS = POLL_MIN_INTERVAL_MS;

export interface PriceSnapshot {
  xlm_usd: number | null;
  sol_usd: number | null;
  fetched_at: number | null; // epoch ms
  stale: boolean;
  source: string | null;
  error: string | null;
  ttl_seconds: number;
}

export interface UsePricesResult {
  prices: PriceSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Force a fresh fetch, bypassing the poll cadence. */
  refresh: () => Promise<void>;
}

async function fetchPrices(): Promise<PriceSnapshot> {
  const dex = await fetchXlmDexPrice();
  return {
    xlm_usd: dex.usd,
    sol_usd: null,
    fetched_at: Date.now(),
    stale: false,
    source: "stellar_horizon",
    error: null,
    ttl_seconds: 60,
  };
}

/**
 * Subscribe to live spot prices. Fetches immediately on mount, then
 * polls every 60 s. Callers can also force a refresh via the returned
 * `refresh()`.
 *
 * Errors are NON-fatal — the hook keeps the last good snapshot and
 * surfaces the error string so consumers can render a small inline
 * warning without losing the price data itself.
 */
export function usePrices(): UsePricesResult {
  const [prices, setPrices] = useState<PriceSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef<boolean>(true);

  const refresh = useCallback(async () => {
    try {
      const snap = await fetchPrices();
      if (!mounted.current) return;
      setPrices(snap);
      setError(null);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { prices, loading, error, refresh };
}

export type Token = "XLM" | "SOL";

export function priceOf(snap: PriceSnapshot | null, token: Token): number | null {
  if (!snap) return null;
  return token === "XLM" ? snap.xlm_usd : snap.sol_usd;
}

/** Convert an amount of a given token to USD. Returns null if the price is unavailable. */
export function tokenToUsd(
  snap: PriceSnapshot | null,
  token: Token,
  amount: number,
): number | null {
  const p = priceOf(snap, token);
  if (p == null || !isFinite(amount)) return null;
  return amount * p;
}

/** Convert USD to an amount of a given token. Returns null if the price is unavailable. */
export function usdToToken(
  snap: PriceSnapshot | null,
  token: Token,
  usd: number,
): number | null {
  const p = priceOf(snap, token);
  if (p == null || !isFinite(usd) || p === 0) return null;
  return usd / p;
}

/**
 * Format USD for compact display. Rules:
 *   * >= 1        → 2 decimals, thousands separator ("$1,234.56")
 *   * 0 <  x < 1 → 4 decimals so sub-dollar amounts stay readable
 *                  ("$0.1848")
 */
export function formatUsd(amount: number | null): string {
  if (amount == null || !isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  const decimals = abs >= 1 ? 2 : 4;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format an amount of a token for compact display.
 *   * >= 1     → up to 4 decimals, trailing zeros trimmed
 *   * < 1      → up to 6 decimals
 */
export function formatToken(amount: number | null, token: Token): string {
  if (amount == null || !isFinite(amount)) return "—";
  const abs = Math.abs(amount);
  const decimals = abs >= 1 ? 4 : 6;
  const s = amount.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  return `${s} ${token}`;
}

/** "32s ago", "3m ago", "just now" — short relative timestamp. */
export function relativeFromNow(epochMs: number | null): string {
  if (!epochMs) return "—";
  const s = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
