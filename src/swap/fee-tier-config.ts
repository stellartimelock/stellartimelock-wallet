/**
 * Editable swap fee tiers.
 *
 * SimpleSwap applies the affiliate fee on the partner API key, so each tier
 * is a separate key created in the SimpleSwap dashboard. The keys live only
 * in the swap proxy (proxy/swap-worker.js) as Worker secrets SS_KEY_UTILITY,
 * SS_KEY_HEAVY and SS_KEY_MEME. The app never holds a key. These lists are
 * for the fee shown in the app and must match the proxy's lists.
 *
 * Rule: cheap, fast, useful coins get the lowest 0.4% utility tier.
 * That is the XLM-like set (fast, cheap to move, and useful as money or
 * infrastructure): XLM, SOL, USDC, USDT, XRP, LTC, TRX, ALGO, ADA, HBAR,
 * NANO/XNO, IOTA, POL/MATIC, AVAX, DOT, ATOM, NEAR, TON, and LINK.
 *
 * Heavy is the 1% Bitcoin tax: BTC, ETH, BNB, BCH, DOGE, and BSV.
 * Everything else stays meme at 1.4%.
 *
 * Which tier a swap uses:
 * - Destination XLM or USDC always uses the utility key, whatever the source.
 * - Otherwise the higher fee of the two coins wins.
 * - A coin that is not on the utility or heavy list is meme.
 * - A blank heavy or meme key in the proxy falls back to the utility key.
 *
 * Provider ticker aliases stay on the same tier as the coin they name.
 * SimpleSwap lists BNB as bnb-bsc and also has avaxc for Avalanche C-chain.
 * NANO and XNO are both listed so either ticker is utility if the provider
 * offers it.
 */

export const FEE_TIERS = {
  utility: {
    id: "utility",
    label: "Utility",
    feePercent: 0.4,
  },
  heavy: {
    id: "heavy",
    label: "Heavy",
    /** Bitcoin tax. */
    note: "Bitcoin tax",
    feePercent: 1,
  },
  meme: {
    id: "meme",
    label: "Meme",
    feePercent: 1.4,
  },
} as const;

export type FeeTierId = keyof typeof FEE_TIERS;

/** Lowest fee first. A later entry is the higher tier. */
export const FEE_TIER_ORDER: readonly FeeTierId[] = ["utility", "heavy", "meme"];

/**
 * 0.4% utility coins. Cheap, fast, useful (XLM-like).
 * avaxc is SimpleSwap's Avalanche C-chain ticker. matic is the old Polygon
 * ticker; pol is the current one. nano and xno are the same coin.
 */
export const UTILITY_COINS = [
  "xlm",
  "sol",
  "usdc",
  "usdt",
  "xrp",
  "ltc",
  "trx",
  "algo",
  "ada",
  "hbar",
  "nano",
  "xno",
  "iota",
  "pol",
  "matic",
  "avax",
  "avaxc",
  "dot",
  "atom",
  "near",
  "ton",
  "link",
] as const;

/**
 * 1% heavy coins (Bitcoin tax): BTC, ETH, BNB, BCH, DOGE, BSV.
 * bnb-bsc is SimpleSwap's BNB ticker. bnb is included so either form is heavy.
 */
export const HEAVY_COINS = [
  "btc",
  "eth",
  "bnb",
  "bnb-bsc",
  "bch",
  "doge",
  "bsv",
] as const;

/** Destinations that always use the utility key, whatever the source coin. */
export const UTILITY_DESTINATION_COINS = ["xlm", "usdc"] as const;

// ---------------------------------------------------------------------------
// Selection. Edit the lists above (and the same lists in the proxy).
// ---------------------------------------------------------------------------

const utilityCoinSet = new Set<string>(UTILITY_COINS);
const heavyCoinSet = new Set<string>(HEAVY_COINS);
const utilityDestinationSet = new Set<string>(UTILITY_DESTINATION_COINS);

/** Bare ticker. "USDT:eth" and " usdc " both become the list key. */
export function normalizeFeeTicker(raw: string): string {
  const head = raw.trim().toLowerCase().split(":")[0] ?? "";
  return head.trim();
}

/** Utility list, then heavy list, otherwise meme. */
export function coinFeeTier(ticker: string): FeeTierId {
  const coin = normalizeFeeTicker(ticker);
  if (utilityCoinSet.has(coin)) return "utility";
  if (heavyCoinSet.has(coin)) return "heavy";
  return "meme";
}

/**
 * Destination XLM or USDC is always utility. Otherwise the higher fee of
 * the two coins wins.
 */
export function selectFeeTier(fromTicker: string, toTicker: string): FeeTierId {
  const destination = normalizeFeeTicker(toTicker);
  if (destination && utilityDestinationSet.has(destination)) return "utility";
  const fromTier = coinFeeTier(fromTicker);
  const toTier = coinFeeTier(toTicker);
  return FEE_TIER_ORDER.indexOf(fromTier) >= FEE_TIER_ORDER.indexOf(toTier)
    ? fromTier
    : toTier;
}

export function describeSwapFee(
  fromTicker: string,
  toTicker: string,
): { tier: FeeTierId; label: string; feePercent: number } {
  const tier = selectFeeTier(fromTicker, toTicker);
  const meta = FEE_TIERS[tier];
  return { tier, label: meta.label, feePercent: meta.feePercent };
}

export function formatFeePercent(feePercent: number): string {
  return `${feePercent}%`;
}
