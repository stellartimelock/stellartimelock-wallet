// @CONTEXT: Where swap requests go. The wallet never holds a SimpleSwap
// partner key. It calls the StellarTimeLock swap proxy (a Cloudflare Worker,
// source in proxy/swap-worker.js), which adds the key for the swap's fee tier
// and forwards only the six SimpleSwap v3 calls swap needs.
//
// EXPO_PUBLIC_SWAP_PROXY_URL can point a build at another proxy (for example
// a self-hosted one). It is a URL, not a secret.

export const DEFAULT_SWAP_PROXY_URL =
  "https://stl-swap-proxy.stellartimelock.workers.dev/v3";

export function swapProxyBaseUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_SWAP_PROXY_URL ?? "").trim();
  const url = fromEnv || DEFAULT_SWAP_PROXY_URL;
  return url.replace(/\/+$/, "");
}
