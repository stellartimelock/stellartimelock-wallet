// Best-effort per-currency destination address format validators.
//
// These are LIGHTWEIGHT client-side sanity checks — SimpleSwap performs
// the authoritative validation server-side and will reject malformed
// addresses. Our goal here is to catch obvious typos (wrong chain,
// missing prefix, checksum length off) BEFORE the network round-trip.
//
// Patterns are intentionally forgiving: we prefer occasional false-
// positives (accepting a real address the regex missed) over false-
// negatives (blocking a valid address). If unsure, `isValidAddress`
// returns `true` so the user can still proceed.

export interface CurrencyAddressRule {
  ticker: string;
  /** Human-readable format hint shown next to the input. */
  hint: string;
  /** Optional destination tag / memo requirement flag. */
  requiresMemo?: boolean;
  /** Return true if the trimmed address plausibly matches this chain. */
  validate: (addr: string) => boolean;
}

const rules: Record<string, CurrencyAddressRule> = {
  btc: {
    ticker: "btc",
    hint: "Legacy 1…, SegWit 3…, or Bech32 bc1…",
    validate: (a) =>
      /^(1[a-km-zA-HJ-NP-Z1-9]{25,34}|3[a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,62})$/.test(
        a,
      ),
  },
  eth: {
    ticker: "eth",
    hint: "42-character hex starting with 0x",
    validate: (a) => /^0x[0-9a-fA-F]{40}$/.test(a),
  },
  usdc: {
    ticker: "usdc",
    hint: "ERC-20 address: 0x… (Ethereum)",
    validate: (a) => /^0x[0-9a-fA-F]{40}$/.test(a),
  },
  usdt20: {
    ticker: "usdt20",
    hint: "ERC-20 address: 0x… (Ethereum)",
    validate: (a) => /^0x[0-9a-fA-F]{40}$/.test(a),
  },
  usdt: {
    ticker: "usdt",
    hint: "ERC-20 address: 0x… (Ethereum)",
    validate: (a) => /^0x[0-9a-fA-F]{40}$/.test(a),
  },
  sol: {
    ticker: "sol",
    hint: "Solana address (Base58, ~32–44 chars)",
    validate: (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a),
  },
  ltc: {
    ticker: "ltc",
    hint: "Legacy L…/M…, Bech32 ltc1…",
    validate: (a) =>
      /^([LM][a-km-zA-HJ-NP-Z1-9]{25,34}|ltc1[a-z0-9]{25,62})$/.test(a),
  },
  ada: {
    ticker: "ada",
    hint: "Shelley addr1… or legacy Ae2…",
    validate: (a) => /^(addr1[a-z0-9]{20,}|Ae2[a-zA-Z0-9]{20,}|DdzFF[a-zA-Z0-9]{20,})$/.test(a),
  },
  xrp: {
    ticker: "xrp",
    hint: "XRP classic address (r…, 25–35 chars)",
    requiresMemo: true,
    validate: (a) => /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a),
  },
  xlm: {
    ticker: "xlm",
    hint: "Stellar public key: G… (56 characters)",
    validate: (a) => /^G[A-Z2-7]{55}$/.test(a),
  },
  doge: {
    ticker: "doge",
    hint: "Dogecoin address starting with D",
    validate: (a) => /^D[A-Za-z0-9]{25,34}$/.test(a),
  },
  bnb: {
    ticker: "bnb",
    hint: "BEP-20 address: 0x… (BSC)",
    validate: (a) => /^0x[0-9a-fA-F]{40}$/.test(a),
  },
  trx: {
    ticker: "trx",
    hint: "Tron address starting with T (34 chars)",
    validate: (a) => /^T[A-Za-z0-9]{33}$/.test(a),
  },
  usdttrc20: {
    ticker: "usdttrc20",
    hint: "TRC-20 (Tron) address starting with T",
    validate: (a) => /^T[A-Za-z0-9]{33}$/.test(a),
  },
  bch: {
    ticker: "bch",
    hint: "Legacy 1…/q…/p… or bitcoincash: prefix",
    validate: (a) =>
      /^(bitcoincash:)?[qp][a-zA-Z0-9]{40,50}$|^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(a),
  },
};

export function getAddressRule(ticker: string): CurrencyAddressRule | null {
  return rules[ticker.toLowerCase()] ?? null;
}

/**
 * Best-effort validation. Returns TRUE for tickers we have no rule for
 * (fail-open — SimpleSwap will validate server-side). Empty addresses
 * always return false.
 */
export function isValidAddress(ticker: string, addr: string): boolean {
  const trimmed = addr.trim();
  if (!trimmed) return false;
  const rule = getAddressRule(ticker);
  if (!rule) return true; // unknown ticker → let backend decide
  return rule.validate(trimmed);
}

export function getAddressHint(ticker: string): string {
  const rule = getAddressRule(ticker);
  return rule?.hint ?? "Enter your destination address for this chain.";
}
