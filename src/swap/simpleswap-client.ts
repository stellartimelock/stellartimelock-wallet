// @CONTEXT: SimpleSwap v3 REST client. The app calls the StellarTimeLock swap
// proxy (src/swap/proxy-config.ts), never the SimpleSwap API directly, and
// holds no partner key. The proxy picks the partner key for the pair's fee
// tier (utility / heavy / meme) from the same lists as fee-tier-config.ts.
// Currencies and per-source pair lists are cached 5 minutes;
// estimates/exchanges are never cached.

import { swapProxyBaseUrl } from "@/src/swap/proxy-config";
import { PREFERRED_NETWORK, parseProviderDestinations } from "@/src/swap/routes";

const CURRENCIES_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types — app-facing shapes mirror the old backend /api/exchange/* responses
// so swap.tsx keeps its existing UI / error flow.
// ---------------------------------------------------------------------------

export interface SimpleSwapCurrency {
  name: string;
  ticker: string;
  network: string;
  legacySymbol?: string;
  hasExtraId?: boolean;
  extraId?: string | null;
  image?: string;
  isFiat?: boolean;
  isAvailableFloat?: boolean;
  isAvailableFixed?: boolean;
}

export interface CurrencyEntry {
  ticker: string;
  name: string;
  enabled: boolean;
  protocol: string;
  image: string;
  extraIdName: string;
}

export interface QuoteResp {
  ok: boolean;
  stage?: string;
  detail?: string;
  from?: string;
  to?: string;
  amount_from?: number;
  amount_to?: string;
  network_fee?: string | null;
  provider_fee?: string | null;
  min_amount?: string | null;
  max_amount?: string | null;
  rate?: number;
  rate_id?: string;
}

export interface CreateResp {
  ok: boolean;
  stage?: string;
  detail?: string;
  transaction_id?: string;
  payin_address?: string;
  payin_extra_id?: string | null;
  amount_expected_from?: string;
  amount_expected_to?: string;
  status?: string;
  created_at?: number;
  currency_from?: string;
  currency_to?: string;
  redirect_url?: string | null;
}

export interface EstimateParams {
  from_currency: string;
  to_currency: string;
  amount_from: number;
}

export interface CreateExchangeParams {
  from_currency: string;
  to_currency: string;
  amount_from: number;
  payout_address: string;
  payout_extra_id?: string;
  refund_address: string;
  refund_extra_id?: string;
  rate_id: string;
}

export interface ResolvedPair {
  tickerFrom: string;
  networkFrom: string;
  tickerTo: string;
  networkTo: string;
}

type Wrapped<T> = { traceId?: string; result: T };

export class SwapClientError extends Error {
  stage: string;
  status?: number;
  minAmount?: string | null;
  maxAmount?: string | null;

  constructor(
    message: string,
    stage: string,
    opts?: { status?: number; minAmount?: string | null; maxAmount?: string | null },
  ) {
    super(message);
    this.name = "SwapClientError";
    this.stage = stage;
    this.status = opts?.status;
    this.minAmount = opts?.minAmount ?? null;
    this.maxAmount = opts?.maxAmount ?? null;
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function isSwapApiKeyConfigured(): boolean {
  return swapProxyBaseUrl().length > 0;
}

export function isSwapConfigured(): boolean {
  return isSwapApiKeyConfigured();
}

// ---------------------------------------------------------------------------
// Low-level HTTP
// ---------------------------------------------------------------------------

function friendlyHttpMessage(status: number, raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("application not found") ||
    lower.includes("wrong api key") ||
    status === 401
  ) {
    return isSwapApiKeyConfigured()
      ? "Swap service temporarily unavailable. Please try again later."
      : "Swap not configured.";
  }
  if (status === 404 || lower.includes("pair not found") || lower.includes("not found")) {
    return "This currency pair is not available for swap right now.";
  }
  if (status === 422 || lower.includes("out of range") || lower.includes("does not fall within")) {
    return "Amount is outside the allowed swap range.";
  }
  if (status === 400) {
    return "Invalid swap request. Check the amount and destination address.";
  }
  if (status >= 500) {
    return "Swap service temporarily unavailable. Please try again later.";
  }
  return "Swap request failed. Please try again.";
}

function parseMinMaxFromMessage(message: string): {
  minAmount?: string;
  maxAmount?: string;
} {
  const minMatch = message.match(/Min:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const maxMatch = message.match(/max:\s*([0-9]+(?:\.[0-9]+)?)/i);
  return {
    minAmount: minMatch?.[1],
    maxAmount: maxMatch?.[1],
  };
}

async function ssFetch<T>(
  path: string,
  init?: RequestInit & {
    query?: Record<string, string | boolean | number | undefined | null>;
  },
): Promise<T> {
  const base = swapProxyBaseUrl();
  if (!base) {
    throw new SwapClientError("Swap not configured.", "not_configured");
  }

  const url = new URL(`${base}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  let res: Response;
  try {
    const { query: _q, ...rest } = init ?? {};
    res = await fetch(url.toString(), {
      ...rest,
      headers: {
        Accept: "application/json",
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(rest.headers ?? {}),
      },
    });
  } catch {
    throw new SwapClientError(
      "Swap service temporarily unavailable. Please try again later.",
      "network",
    );
  }

  const text = await res.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "message" in json
        ? String((json as { message?: unknown }).message ?? "")
        : text;
    const friendly = friendlyHttpMessage(res.status, msg || text || res.statusText);
    const range = parseMinMaxFromMessage(msg);
    const stage =
      res.status === 422 || range.minAmount
        ? "below_minimum"
        : res.status === 404
          ? "invalid_pair"
          : res.status === 401
            ? "not_configured"
            : "provider";
    throw new SwapClientError(friendly, stage, {
      status: res.status,
      minAmount: range.minAmount ?? null,
      maxAmount: range.maxAmount ?? null,
    });
  }

  // Wrapped { traceId, result } — also accept bare result for resilience.
  if (json && typeof json === "object" && "result" in json) {
    return (json as Wrapped<T>).result;
  }
  return json as T;
}

async function backendFetch<T>(
  _path: string,
  _init?: RequestInit,
): Promise<T> {
  void _path;
  void _init;
  throw new SwapClientError("Swap API key not configured.", "not_configured");
}

/**
 * Swap data source: always the swap proxy (the legacy backend path is gone).
 * Kept as a wrapper so call sites stay unchanged.
 */
async function withBackendFallback<T>(
  _backendCall: () => Promise<T>,
  directCall: () => Promise<T>,
): Promise<T> {
  if (!isSwapApiKeyConfigured()) {
    throw new SwapClientError("Swap API key not configured.", "not_configured");
  }
  return directCall();
}

// ---------------------------------------------------------------------------
// Currency cache + ticker → network resolution
// ---------------------------------------------------------------------------

let currenciesCache: { at: number; list: SimpleSwapCurrency[] } | null = null;
/** UI ticker → resolved SimpleSwap ticker/network (from last currencies load). */
let resolvedNetworkByTicker: Map<string, { ticker: string; network: string }> =
  new Map();

function pickPreferred(
  ticker: string,
  candidates: SimpleSwapCurrency[],
): SimpleSwapCurrency | null {
  if (candidates.length === 0) return null;
  const preferred = PREFERRED_NETWORK[ticker.toLowerCase()];
  if (preferred) {
    const hit = candidates.find(
      (c) => c.network.toLowerCase() === preferred && c.isAvailableFixed !== false,
    );
    if (hit) return hit;
    const anyPref = candidates.find((c) => c.network.toLowerCase() === preferred);
    if (anyPref) return anyPref;
  }
  const native = candidates.find(
    (c) =>
      c.network.toLowerCase() === ticker.toLowerCase() &&
      c.isAvailableFixed !== false,
  );
  if (native) return native;
  const nativeAny = candidates.find(
    (c) => c.network.toLowerCase() === ticker.toLowerCase(),
  );
  if (nativeAny) return nativeAny;
  const fixed = candidates.find((c) => c.isAvailableFixed);
  return fixed ?? candidates[0] ?? null;
}

function rebuildResolutionIndex(list: SimpleSwapCurrency[]): void {
  const byTicker = new Map<string, SimpleSwapCurrency[]>();
  for (const c of list) {
    if (c.isFiat) continue;
    const t = (c.ticker || "").toLowerCase();
    if (!t) continue;
    const arr = byTicker.get(t) ?? [];
    arr.push(c);
    byTicker.set(t, arr);
  }
  const next = new Map<string, { ticker: string; network: string }>();
  for (const [ticker, candidates] of byTicker) {
    const picked = pickPreferred(ticker, candidates);
    if (!picked) continue;
    next.set(ticker, {
      ticker: picked.ticker.toLowerCase(),
      network: picked.network.toLowerCase(),
    });
  }
  // Also index explicit preferred pairs even if grouping missed them.
  for (const [ticker, network] of Object.entries(PREFERRED_NETWORK)) {
    if (next.has(ticker)) continue;
    const hit = list.find(
      (c) =>
        c.ticker.toLowerCase() === ticker &&
        c.network.toLowerCase() === network,
    );
    if (hit) {
      next.set(ticker, { ticker: hit.ticker.toLowerCase(), network: hit.network.toLowerCase() });
    }
  }
  resolvedNetworkByTicker = next;
}

function parseTickerNetwork(raw: string): { ticker: string; network?: string } {
  const s = raw.trim().toLowerCase();
  if (s.includes(":")) {
    const [ticker, network] = s.split(":");
    return { ticker, network };
  }
  return { ticker: s };
}

export async function resolvePair(
  fromCurrency: string,
  toCurrency: string,
): Promise<ResolvedPair> {
  // Ensure resolution index is warm.
  await getCurrencies();
  const from = parseTickerNetwork(fromCurrency);
  const to = parseTickerNetwork(toCurrency);

  const fromResolved =
    from.network != null
      ? { ticker: from.ticker, network: from.network }
      : resolvedNetworkByTicker.get(from.ticker) ?? {
          ticker: from.ticker,
          network: PREFERRED_NETWORK[from.ticker] ?? from.ticker,
        };

  const toResolved =
    to.network != null
      ? { ticker: to.ticker, network: to.network }
      : resolvedNetworkByTicker.get(to.ticker) ?? {
          ticker: to.ticker,
          network: PREFERRED_NETWORK[to.ticker] ?? to.ticker,
        };

  return {
    tickerFrom: fromResolved.ticker,
    networkFrom: fromResolved.network,
    tickerTo: toResolved.ticker,
    networkTo: toResolved.network,
  };
}

/** Resolve one bare ticker the same way estimates and exchanges will. */
export async function resolveCurrency(
  raw: string,
): Promise<{ ticker: string; network: string }> {
  await getCurrencies();
  return resolvedPairSide(raw);
}

/**
 * Ticker + network the client will submit. Uses the currency index when it
 * is already loaded, otherwise the preferred-network map.
 */
export function resolvedPairSide(raw: string): { ticker: string; network: string } {
  const parsed = parseTickerNetwork(raw);
  if (parsed.network) return { ticker: parsed.ticker, network: parsed.network };
  const hit = resolvedNetworkByTicker.get(parsed.ticker);
  if (hit) return { ticker: hit.ticker, network: hit.network };
  return {
    ticker: parsed.ticker,
    network: PREFERRED_NETWORK[parsed.ticker] ?? parsed.ticker,
  };
}

export interface SwapSourceRoutes {
  /** Ticker the screen asked about, lowercased. */
  requestedTicker: string;
  fromTicker: string;
  fromNetwork: string;
  /** Destination keys (`ticker:network`) SimpleSwap lists for this source. */
  destinations: string[];
}

let pairsCache: Map<string, { at: number; dests: string[] }> = new Map();

/**
 * Destinations SimpleSwap will accept from `fromCurrency` at a fixed rate.
 * Uses the filtered pairs call (`/pairs/{ticker}/{network}`) so the phone
 * downloads one source, not the full pair map. Same API key as exchanges.
 */
export async function fetchSwapSourceRoutes(
  fromCurrency: string,
): Promise<SwapSourceRoutes> {
  if (!isSwapApiKeyConfigured()) {
    throw new SwapClientError("Swap API key not configured.", "not_configured");
  }
  const side = await resolveCurrency(fromCurrency);
  const sourceKey = `${side.ticker}:${side.network}`;
  const now = Date.now();
  const cached = pairsCache.get(sourceKey);
  const requestedTicker = fromCurrency.trim().toLowerCase();
  if (cached && now - cached.at < CURRENCIES_TTL_MS) {
    return {
      requestedTicker,
      fromTicker: side.ticker,
      fromNetwork: side.network,
      destinations: cached.dests,
    };
  }
  const result = await ssFetch<unknown>(
    `/pairs/${encodeURIComponent(side.ticker)}/${encodeURIComponent(side.network)}`,
    {
      method: "GET",
      query: { fixed: true },
    },
  );
  const dests = parseProviderDestinations(result, sourceKey);
  pairsCache.set(sourceKey, { at: now, dests });
  return {
    requestedTicker,
    fromTicker: side.ticker,
    fromNetwork: side.network,
    destinations: dests,
  };
}

/** Fixed-rate min/max for a pair. Same provider and fee path as the quote. */
export async function fetchSwapRange(
  fromCurrency: string,
  toCurrency: string,
): Promise<{ min: string | null; max: string | null }> {
  const pair = await resolvePair(fromCurrency, toCurrency);
  const ranges = await getRanges({
    ...pair,
    fixed: true,
  });
  return { min: ranges.min ?? null, max: ranges.max ?? null };
}

function mapToCurrencyEntries(list: SimpleSwapCurrency[]): CurrencyEntry[] {
  const byTicker = new Map<string, SimpleSwapCurrency[]>();
  for (const c of list) {
    if (c.isFiat) continue;
    const t = (c.ticker || "").toLowerCase();
    if (!t) continue;
    const arr = byTicker.get(t) ?? [];
    arr.push(c);
    byTicker.set(t, arr);
  }
  const out: CurrencyEntry[] = [];
  for (const [ticker, candidates] of byTicker) {
    const picked = pickPreferred(ticker, candidates);
    if (!picked) continue;
    out.push({
      ticker,
      name: picked.name || ticker.toUpperCase(),
      enabled: picked.isAvailableFixed !== false,
      protocol: picked.network || "",
      image: picked.image || "",
      extraIdName: picked.hasExtraId ? (picked.extraId || "Memo") : "",
    });
  }
  out.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return out;
}

// ---------------------------------------------------------------------------
// PART 1 — Direct SimpleSwap API functions
// ---------------------------------------------------------------------------

/** GET /currencies — cached 5 minutes. */
export async function getCurrencies(): Promise<SimpleSwapCurrency[]> {
  const now = Date.now();
  if (currenciesCache && now - currenciesCache.at < CURRENCIES_TTL_MS) {
    return currenciesCache.list;
  }
  const result = await ssFetch<SimpleSwapCurrency[]>("/currencies");
  const list = Array.isArray(result) ? result : [];
  currenciesCache = { at: now, list };
  rebuildResolutionIndex(list);
  return list;
}

/** GET /estimates?fixed=true&... */
export async function getEstimate(params: {
  tickerFrom: string;
  networkFrom: string;
  tickerTo: string;
  networkTo: string;
  amount: string | number;
  fixed?: boolean;
  reverse?: boolean;
}): Promise<{ estimatedAmount: string; rateId?: string | null; validUntil?: string | null }> {
  return ssFetch("/estimates", {
    method: "GET",
    query: {
      fixed: params.fixed ?? true,
      reverse: params.reverse ?? false,
      tickerFrom: params.tickerFrom,
      networkFrom: params.networkFrom,
      tickerTo: params.tickerTo,
      networkTo: params.networkTo,
      amount: String(params.amount),
    },
  });
}

/** GET /ranges?fixed=true&... */
export async function getRanges(params: {
  tickerFrom: string;
  networkFrom: string;
  tickerTo: string;
  networkTo: string;
  fixed?: boolean;
}): Promise<{ min?: string | null; max?: string | null }> {
  return ssFetch("/ranges", {
    method: "GET",
    query: {
      fixed: params.fixed ?? true,
      tickerFrom: params.tickerFrom,
      networkFrom: params.networkFrom,
      tickerTo: params.tickerTo,
      networkTo: params.networkTo,
    },
  });
}

/** POST /exchanges */
export async function createExchange(params: {
  tickerFrom: string;
  networkFrom: string;
  tickerTo: string;
  networkTo: string;
  amount: string | number;
  addressTo: string;
  extraIdTo?: string;
  userRefundAddress?: string;
  userRefundExtraId?: string;
  rateId?: string;
  fixed?: boolean;
  reverse?: boolean;
}): Promise<Record<string, unknown>> {
  return ssFetch("/exchanges", {
    method: "POST",
    body: JSON.stringify({
      tickerFrom: params.tickerFrom,
      networkFrom: params.networkFrom,
      tickerTo: params.tickerTo,
      networkTo: params.networkTo,
      amount: String(params.amount),
      fixed: params.fixed ?? true,
      reverse: params.reverse ?? false,
      addressTo: params.addressTo,
      ...(params.extraIdTo ? { extraIdTo: params.extraIdTo } : {}),
      ...(params.userRefundAddress
        ? { userRefundAddress: params.userRefundAddress }
        : {}),
      ...(params.userRefundExtraId
        ? { userRefundExtraId: params.userRefundExtraId }
        : {}),
      ...(params.rateId ? { rateId: params.rateId } : {}),
    }),
  });
}

/** GET /exchanges/{id} */
export async function getExchangeStatus(id: string): Promise<Record<string, unknown>> {
  return ssFetch(`/exchanges/${encodeURIComponent(id)}`, {
    method: "GET",
  });
}

// ---------------------------------------------------------------------------
// App-facing helpers (backend fallback + UI response shapes)
// ---------------------------------------------------------------------------

function quoteFromError(e: unknown): QuoteResp {
  if (e instanceof SwapClientError) {
    return {
      ok: false,
      stage: e.stage,
      detail: e.message,
      min_amount: e.minAmount ?? null,
      max_amount: e.maxAmount ?? null,
    };
  }
  return {
    ok: false,
    stage: "network",
    detail: "Swap service temporarily unavailable. Please try again later.",
  };
}

function createFromError(e: unknown): CreateResp {
  if (e instanceof SwapClientError) {
    return { ok: false, stage: e.stage, detail: e.message };
  }
  return {
    ok: false,
    stage: "network",
    detail: "Swap service temporarily unavailable. Please try again later.",
  };
}

async function estimateDirect(params: EstimateParams): Promise<QuoteResp> {
  if (!isSwapApiKeyConfigured()) {
    return {
      ok: false,
      stage: "not_configured",
      detail: "Swap not configured.",
    };
  }
  try {
    const pair = await resolvePair(params.from_currency, params.to_currency);
    let minAmount: string | null = null;
    let maxAmount: string | null = null;
    try {
      const ranges = await getRanges({ ...pair });
      minAmount = ranges.min ?? null;
      maxAmount = ranges.max ?? null;
    } catch {
      // Ranges are best-effort; estimate can still succeed.
    }

    const est = await getEstimate({
      ...pair,
      amount: params.amount_from,
      fixed: true,
      reverse: false,
    });

    const amountTo = est.estimatedAmount;
    const amountFrom = params.amount_from;
    const rate =
      amountFrom > 0 && amountTo != null
        ? Number(amountTo) / amountFrom
        : undefined;

    return {
      ok: true,
      from: params.from_currency.toLowerCase(),
      to: params.to_currency.toLowerCase(),
      amount_from: amountFrom,
      amount_to: amountTo,
      network_fee: null,
      provider_fee: null,
      min_amount: minAmount,
      max_amount: maxAmount,
      rate: Number.isFinite(rate) ? rate : undefined,
      rate_id: est.rateId ?? undefined,
    };
  } catch (e) {
    const q = quoteFromError(e);
    // If we got below_minimum without min from the error, try ranges.
    if (q.stage === "below_minimum" && !q.min_amount) {
      try {
        const pair = await resolvePair(params.from_currency, params.to_currency);
        const ranges = await getRanges({ ...pair });
        q.min_amount = ranges.min ?? null;
        q.max_amount = ranges.max ?? null;
      } catch {
        /* ignore */
      }
    }
    return q;
  }
}

async function createDirect(params: CreateExchangeParams): Promise<CreateResp> {
  if (!isSwapApiKeyConfigured()) {
    return {
      ok: false,
      stage: "not_configured",
      detail: "Swap not configured.",
    };
  }
  try {
    const pair = await resolvePair(params.from_currency, params.to_currency);
    const raw = await createExchange({
      ...pair,
      amount: params.amount_from,
      addressTo: params.payout_address,
      extraIdTo: params.payout_extra_id || undefined,
      userRefundAddress: params.refund_address || undefined,
      userRefundExtraId: params.refund_extra_id || undefined,
      rateId: params.rate_id,
      fixed: true,
      reverse: false,
    });

    const createdAtRaw = raw.createdAt;
    let createdAt: number | undefined;
    if (typeof createdAtRaw === "string") {
      const ms = Date.parse(createdAtRaw);
      createdAt = Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
    } else if (typeof createdAtRaw === "number") {
      createdAt = createdAtRaw > 1e12 ? Math.floor(createdAtRaw / 1000) : createdAtRaw;
    }

    return {
      ok: true,
      transaction_id: String(raw.publicId ?? ""),
      payin_address: String(raw.addressFrom ?? ""),
      payin_extra_id:
        raw.extraIdFrom == null || raw.extraIdFrom === ""
          ? null
          : String(raw.extraIdFrom),
      amount_expected_from: String(raw.amountFrom ?? params.amount_from),
      amount_expected_to: String(raw.amountTo ?? ""),
      status: raw.status != null ? String(raw.status) : undefined,
      created_at: createdAt,
      currency_from: String(raw.tickerFrom ?? params.from_currency).toLowerCase(),
      currency_to: String(raw.tickerTo ?? params.to_currency).toLowerCase(),
      redirect_url:
        raw.redirectUrl == null || raw.redirectUrl === ""
          ? null
          : String(raw.redirectUrl),
    };
  } catch (e) {
    return createFromError(e);
  }
}

/** Currencies for the swap picker (enabled only). */
export async function fetchSwapCurrencies(): Promise<CurrencyEntry[]> {
  return withBackendFallback(
    async () => {
      const r = await backendFetch<{ ok: boolean; currencies?: CurrencyEntry[] }>(
        "/exchange/currencies",
      );
      if (!r.ok || !Array.isArray(r.currencies)) {
        throw new SwapClientError(
          "Swap service temporarily unavailable. Please try again later.",
          "provider",
        );
      }
      return r.currencies.filter((c) => c.enabled);
    },
    async () => {
      if (!isSwapApiKeyConfigured()) {
        throw new SwapClientError("Swap API key not configured.", "not_configured");
      }
      const list = await getCurrencies();
      return mapToCurrencyEntries(list).filter((c) => c.enabled);
    },
  );
}

/** Fixed-rate quote — returns the UI QuoteResp shape (ok:false on failure). */
export async function fetchSwapEstimate(params: EstimateParams): Promise<QuoteResp> {
  if (!isSwapApiKeyConfigured()) {
    return {
      ok: false,
      stage: "not_configured",
      detail: "Swap API key not configured.",
    };
  }
  return withBackendFallback(
    async () => {
      const q = await backendFetch<QuoteResp>("/exchange/estimate", {
        method: "POST",
        body: JSON.stringify(params),
      });
      // Backend sometimes returns ok:false with a raw provider message.
      if (q.detail && /application not found/i.test(q.detail)) {
        throw new SwapClientError(
          "Swap service temporarily unavailable. Please try again later.",
          "provider",
        );
      }
      return q;
    },
    () => estimateDirect(params),
  );
}

/** Create fixed-rate exchange — returns the UI CreateResp shape. */
export async function fetchSwapCreate(
  params: CreateExchangeParams,
): Promise<CreateResp> {
  if (!isSwapApiKeyConfigured()) {
    return {
      ok: false,
      stage: "not_configured",
      detail: "Swap API key not configured.",
    };
  }
  return withBackendFallback(
    async () => {
      const c = await backendFetch<CreateResp>("/exchange", {
        method: "POST",
        body: JSON.stringify(params),
      });
      if (c.detail && /application not found/i.test(c.detail)) {
        throw new SwapClientError(
          "Swap service temporarily unavailable. Please try again later.",
          "provider",
        );
      }
      return c;
    },
    () => createDirect(params),
  );
}
