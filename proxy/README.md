# Swap proxy

`swap-worker.js` is the Cloudflare Worker the wallet uses for swaps
(`https://stl-swap-proxy.stellartimelock.workers.dev/v3`). It exists so the
SimpleSwap partner keys never ship inside the app.

- Forwards only: `GET /v3/currencies`, `GET /v3/pairs/{ticker}/{network}`,
  `GET /v3/estimates`, `GET /v3/ranges`, `POST /v3/exchanges`,
  `GET /v3/exchanges/{id}`. Everything else is 404.
- Only known query and body fields are passed on.
- Picks the partner key for the pair's fee tier. The tier lists must match
  `src/swap/fee-tier-config.ts`; `tests/swap-fee-tiers.test.ts` checks this.
- Rate limits per client IP (120 requests/min, 10 new exchanges/min).
- No logs, no storage. `GET /health` reports whether a key is configured and
  a short fingerprint of it (first 5 bytes of its SHA-256), never the key.

Secrets (set in Cloudflare, never in git): `SS_KEY_UTILITY` (required),
`SS_KEY_HEAVY` and `SS_KEY_MEME` (optional; blank falls back to utility).

Bindings: rate limits `RL_ALL` (namespace 7301, 120/60s) and `RL_CREATE`
(namespace 7302, 10/60s).

To run your own, deploy this file as a module Worker with those bindings and
secrets, then build the app with `EXPO_PUBLIC_SWAP_PROXY_URL` set to it.
