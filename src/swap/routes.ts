// Route selection for swaps.
//
// Every accepted route is a single direct SimpleSwap pair. The app does not
// invent a second hop, and it does not switch providers. Estimates, ranges,
// and exchanges go through the SimpleSwap client and the swap proxy. The partner key for a pair
// comes from the fee tier in fee-tier-config.ts.

export const SWAP_ROUTE_PROVIDER = "simpleswap" as const;

/** Preferred network for a bare ticker. Matches the address validators. */
export const PREFERRED_NETWORK: Record<string, string> = {
  xlm: "xlm",
  sol: "sol",
  ltc: "ltc",
  xrp: "xrp",
  ada: "ada",
  btc: "btc",
  eth: "eth",
  doge: "doge",
  trx: "trx",
  bch: "bch",
  // Featured USDT/USDC are ERC-20 (Ethereum).
  usdt: "eth",
  usdc: "eth",
  bnb: "bsc",
};

export function networkForTicker(ticker: string): string {
  const t = ticker.trim().toLowerCase();
  return PREFERRED_NETWORK[t] ?? t;
}

export interface SelectedSwapRoute {
  provider: typeof SWAP_ROUTE_PROVIDER;
  /** One provider exchange. Not a bridge through another asset. */
  kind: "direct";
  fromTicker: string;
  fromNetwork: string;
  toTicker: string;
  toNetwork: string;
  destinationKey: string;
}

export type RouteSelection =
  | { ok: true; route: SelectedSwapRoute }
  | {
      ok: false;
      code: "same_currency" | "unsupported_pair" | "incomplete";
      message: string;
    };

export interface SelectSwapRouteInput {
  fromTicker: string;
  toTicker: string;
  fromNetwork: string;
  toNetwork: string;
  /** Destination keys ("ticker:network") the provider lists for this source. */
  destinations: readonly string[];
  /** Symbols shown to the user when a pair is rejected. */
  displayFrom?: string;
  displayTo?: string;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function sideLabel(display: string | undefined, ticker: string, network: string): string {
  const base = (display || ticker).trim().toUpperCase();
  const net = norm(network);
  const tick = norm(ticker);
  const shown = norm(display || ticker);
  if (net && net !== tick && net !== shown) {
    return `${base} · ${net.toUpperCase()}`;
  }
  return base || "this currency";
}

/**
 * Pick the direct provider route for a pair, or explain why it cannot run.
 * A missing direct destination is unsupported even when both assets could
 * reach each other through a third currency — this app only submits pairs
 * the provider lists.
 */
export function selectSwapRoute(input: SelectSwapRouteInput): RouteSelection {
  const fromTicker = norm(input.fromTicker);
  const toTicker = norm(input.toTicker);
  const fromNetwork = norm(input.fromNetwork);
  const toNetwork = norm(input.toNetwork);
  const fromShown = sideLabel(input.displayFrom, fromTicker, fromNetwork);
  const toShown = sideLabel(input.displayTo, toTicker, toNetwork);

  if (!fromTicker || !toTicker) {
    return {
      ok: false,
      code: "incomplete",
      message: "Choose a currency to send and a currency to receive.",
    };
  }
  if (fromTicker === toTicker && fromNetwork === toNetwork) {
    return {
      ok: false,
      code: "same_currency",
      message: "Choose two different currencies.",
    };
  }
  if (!fromNetwork || !toNetwork) {
    return {
      ok: false,
      code: "unsupported_pair",
      message: `${fromShown} → ${toShown} is not available. The swap provider does not offer this pair.`,
    };
  }

  const destinationKey = `${toTicker}:${toNetwork}`;
  const offered = input.destinations.some((dest) => norm(dest) === destinationKey);
  if (!offered) {
    return {
      ok: false,
      code: "unsupported_pair",
      message: `${fromShown} → ${toShown} is not available. The swap provider does not offer this pair.`,
    };
  }

  return {
    ok: true,
    route: {
      provider: SWAP_ROUTE_PROVIDER,
      kind: "direct",
      fromTicker,
      fromNetwork,
      toTicker,
      toNetwork,
      destinationKey,
    },
  };
}

/** True when `amount` is under the provider minimum or over the maximum. */
export function amountWithinRange(
  amount: number,
  min: string | null | undefined,
  max: string | null | undefined,
): { belowMinimum: boolean; aboveMaximum: boolean } {
  const minN = min == null || String(min).trim() === "" ? null : Number(min);
  const maxN = max == null || String(max).trim() === "" ? null : Number(max);
  return {
    belowMinimum:
      minN != null && Number.isFinite(minN) && Number.isFinite(amount) && amount < minN,
    aboveMaximum:
      maxN != null && Number.isFinite(maxN) && Number.isFinite(amount) && amount > maxN,
  };
}

function destinationKeyFromUnknown(item: unknown): string {
  if (typeof item === "string") {
    const s = item.trim().toLowerCase();
    return s.includes(":") ? s : "";
  }
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  const ticker = String(record.tickerTo ?? record.ticker ?? "")
    .trim()
    .toLowerCase();
  const network = String(record.networkTo ?? record.network ?? "")
    .trim()
    .toLowerCase();
  if (!ticker || !network) return "";
  return `${ticker}:${network}`;
}

/**
 * Normalize a SimpleSwap `/pairs/{ticker}/{network}` payload into
 * destination keys. Accepts the unwrapped result or a `{ result }` body.
 */
export function parseProviderDestinations(payload: unknown, sourceKey?: string): string[] {
  let node = payload;
  if (node && typeof node === "object" && "result" in node) {
    node = (node as { result: unknown }).result;
  }
  const collect = (items: unknown[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const key = destinationKeyFromUnknown(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  };
  if (Array.isArray(node)) return collect(node);
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  if (sourceKey) {
    const keyed = record[sourceKey] ?? record[sourceKey.toLowerCase()];
    if (Array.isArray(keyed)) return collect(keyed);
  }
  const arrays = Object.values(record).filter(Array.isArray) as unknown[][];
  if (arrays.length === 1) return collect(arrays[0]);
  return [];
}
