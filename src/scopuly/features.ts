// What Scopuly ships that this wallet does not.
// Sources are Scopuly's own pages. Roadmap items (NFT market, crypto
// cards, staking marked "soon") are left off.

export interface ScopulyFeature {
  title: string;
  detail: string;
}

export const SCOPULY_FEATURES: ScopulyFeature[] = [
  {
    title: "Stellar DEX trading",
    detail: "Order-book trades between Stellar assets.",
  },
  {
    title: "Path-payment swap",
    detail: "Swap two Stellar assets through the order book.",
  },
  {
    title: "Liquidity pools",
    detail: "Add assets to a Stellar AMM pool.",
  },
  {
    title: "Fiat buy and sell",
    detail: "Buy or sell crypto for fiat in the Scopuly app.",
  },
  {
    title: "Claimable balances",
    detail: "Create and collect Stellar claimable balances.",
  },
  {
    title: "Issue a token",
    detail: "Issue a Stellar asset and list it on the DEX.",
  },
  {
    title: "Asset directory",
    detail: "Issuers, prices, and charts for Stellar assets.",
  },
];

export const SCOPULY_X_URL = "https://x.com/scopuly";
/** Official Android package id from Scopuly's Google Play listing. */
export const SCOPULY_ANDROID_PACKAGE = "com.sdex.app";
export const SCOPULY_PLAY_URL =
  `https://play.google.com/store/apps/details?id=${SCOPULY_ANDROID_PACKAGE}`;
/** Android Play Store listing. The https URL is the fallback when market:// cannot open. */
export const SCOPULY_PLAY_MARKET = `market://details?id=${SCOPULY_ANDROID_PACKAGE}`;
export const SCOPULY_LOGO_SOURCE = "https://scopuly.com/img/logo/icon.png";
