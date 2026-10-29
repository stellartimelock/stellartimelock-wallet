// StellarTimeLock swap proxy.
// The wallet calls this Worker instead of api.simpleswap.io so the SimpleSwap
// partner keys never ship inside the app. The Worker:
//   - forwards only the six SimpleSwap v3 calls the wallet uses,
//   - picks the partner key for the swap's fee tier (keys are Worker secrets),
//   - rate-limits per client IP,
//   - keeps no logs and stores nothing.
// Fee tiers mirror src/swap/fee-tier-config.ts in the wallet.

const UPSTREAM = "https://api.simpleswap.io/v3";

const UTILITY = new Set(["xlm","sol","usdc","usdt","xrp","ltc","trx","algo","ada","hbar","nano","xno","iota","pol","matic","avax","avaxc","dot","atom","near","ton","link"]);
const HEAVY = new Set(["btc","eth","bnb","bnb-bsc","bch","doge","bsv"]);
const UTILITY_DEST = new Set(["xlm","usdc"]);
const ORDER = ["utility","heavy","meme"];

const norm = (t) => String(t ?? "").trim().toLowerCase().split(":")[0].trim();
const coinTier = (t) => (UTILITY.has(norm(t)) ? "utility" : HEAVY.has(norm(t)) ? "heavy" : "meme");
export function selectTier(from, to) {
  if (UTILITY_DEST.has(norm(to))) return "utility";
  const a = coinTier(from), b = coinTier(to);
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}
function keyFor(env, tier) {
  const k = { utility: env.SS_KEY_UTILITY, heavy: env.SS_KEY_HEAVY, meme: env.SS_KEY_MEME }[tier];
  return (k && k.trim()) || (env.SS_KEY_UTILITY || "").trim();
}

const TICKER = /^[a-z0-9-]{1,32}$/i;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const EST_Q = ["fixed","reverse","tickerFrom","networkFrom","tickerTo","networkTo","amount"];
const RANGE_Q = ["fixed","tickerFrom","networkFrom","tickerTo","networkTo"];
const EX_BODY = ["tickerFrom","networkFrom","tickerTo","networkTo","amount","fixed","reverse","addressTo","extraIdTo","userRefundAddress","userRefundExtraId","rateId"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};
const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS } });

function pick(params, allowed) {
  const out = new URLSearchParams();
  for (const k of allowed) {
    const v = params.get(k);
    if (v !== null && v !== "" && v.length <= 128) out.set(k, v);
  }
  return out;
}

async function upstream(env, tier, path, init = {}) {
  const key = keyFor(env, tier);
  if (!key) return json(503, { message: "Swap not configured" });
  let res;
  try {
    res = await fetch(UPSTREAM + path, {
      ...init,
      headers: { Accept: "application/json", "x-api-key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    return json(502, { message: "Swap service temporarily unavailable" });
  }
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (pathname === "/health") {
      const k = (env.SS_KEY_UTILITY || "").trim();
      const h = k ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(k)))).slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("") : "";
      return json(200, { ok: true, configured: k.length > 0, fp: h });
    }

    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (env.RL_ALL) {
      const { success } = await env.RL_ALL.limit({ key: ip });
      if (!success) return json(429, { message: "Too many requests. Try again in a minute." });
    }

    const parts = pathname.replace(/^\/v3/, "").split("/").filter(Boolean);

    if (request.method === "GET") {
      if (parts.length === 1 && parts[0] === "currencies") return upstream(env, "utility", "/currencies");
      if (parts.length === 3 && parts[0] === "pairs" && TICKER.test(parts[1]) && TICKER.test(parts[2])) {
        const q = pick(url.searchParams, ["fixed"]);
        return upstream(env, "utility", `/pairs/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}?${q}`);
      }
      if (parts.length === 1 && parts[0] === "estimates") {
        const q = pick(url.searchParams, EST_Q);
        return upstream(env, selectTier(q.get("tickerFrom"), q.get("tickerTo")), `/estimates?${q}`);
      }
      if (parts.length === 1 && parts[0] === "ranges") {
        const q = pick(url.searchParams, RANGE_Q);
        return upstream(env, selectTier(q.get("tickerFrom"), q.get("tickerTo")), `/ranges?${q}`);
      }
      if (parts.length === 2 && parts[0] === "exchanges" && ID.test(parts[1])) {
        return upstream(env, "utility", `/exchanges/${encodeURIComponent(parts[1])}`);
      }
    }

    if (request.method === "POST" && parts.length === 1 && parts[0] === "exchanges") {
      if (env.RL_CREATE) {
        const { success } = await env.RL_CREATE.limit({ key: ip });
        if (!success) return json(429, { message: "Too many swaps started. Try again in a minute." });
      }
      const raw = await request.text();
      if (raw.length > 4096) return json(413, { message: "Request too large" });
      let input;
      try { input = JSON.parse(raw); } catch { return json(400, { message: "Invalid JSON" }); }
      if (!input || typeof input !== "object") return json(400, { message: "Invalid body" });
      const body = {};
      for (const k of EX_BODY) if (input[k] !== undefined && input[k] !== null && input[k] !== "") body[k] = input[k];
      return upstream(env, selectTier(body.tickerFrom, body.tickerTo), "/exchanges", { method: "POST", body: JSON.stringify(body) });
    }

    return json(404, { message: "Not found" });
  },
};
