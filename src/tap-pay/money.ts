// Exact XLM amounts. Stellar payments use 7 decimal places (stroops).
// Limits and history store the canonical string so a float cannot drift.

const STROOPS = 10_000_000n;
const MAX_STROOPS = 1_000_000_000n * STROOPS;

const AMOUNT_RE = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,7})?$/;

export function parseAmountToStroops(amount: string): bigint | null {
  const trimmed = amount.trim();
  if (!AMOUNT_RE.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const stroops = BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, "0"));
  if (stroops <= 0n || stroops > MAX_STROOPS) return null;
  return stroops;
}

export function stroopsToAmount(stroops: bigint): string {
  if (stroops < 0n) throw new Error("negative amount");
  const whole = stroops / STROOPS;
  const frac = (stroops % STROOPS).toString().padStart(7, "0");
  return `${whole.toString()}.${frac}`;
}

/** Canonical 7-decimal XLM string, or null when the text is not a payment amount. */
export function canonicalAmount(amount: string): string | null {
  const stroops = parseAmountToStroops(amount);
  if (stroops == null) return null;
  return stroopsToAmount(stroops);
}

export function trimAmount(canonical: string): string {
  const [whole, frac = ""] = canonical.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function addAmounts(a: string, b: string): string | null {
  const left = parseAmountToStroops(a);
  const right = parseAmountToStroops(b);
  if (left == null || right == null) return null;
  const sum = left + right;
  if (sum > MAX_STROOPS) return null;
  return stroopsToAmount(sum);
}

export function compareAmounts(a: string, b: string): number | null {
  const left = parseAmountToStroops(a);
  const right = parseAmountToStroops(b);
  if (left == null || right == null) return null;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function amountsEqual(a: string, b: string): boolean {
  return compareAmounts(a, b) === 0;
}

/** USD text (up to 2 decimals) to a canonical XLM amount at the given XLM/USD rate. */
export function usdToXlmAmount(usd: string, xlmUsd: number): string | null {
  const trimmed = usd.trim();
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(trimmed)) return null;
  if (!(xlmUsd > 0) || !Number.isFinite(xlmUsd)) return null;
  const usdNumber = Number(trimmed);
  if (!(usdNumber > 0)) return null;
  const stroops = Math.round((usdNumber / xlmUsd) * 1e7);
  if (!Number.isSafeInteger(stroops) || stroops <= 0) return null;
  if (BigInt(stroops) > MAX_STROOPS) return null;
  return stroopsToAmount(BigInt(stroops));
}

/** Canonical XLM amount to a USD display string with 2 decimals. */
export function xlmToUsd(amount: string, xlmUsd: number): string | null {
  const stroops = parseAmountToStroops(amount);
  if (stroops == null || !(xlmUsd > 0) || !Number.isFinite(xlmUsd)) return null;
  const xlm = Number(stroops) / 1e7;
  if (!Number.isFinite(xlm)) return null;
  return (xlm * xlmUsd).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function truncateUtf8(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const encoder = new TextEncoder();
  let out = "";
  let used = 0;
  for (const ch of input) {
    const bytes = encoder.encode(ch).length;
    if (used + bytes > maxBytes) break;
    out += ch;
    used += bytes;
  }
  return out;
}

export function utf8Length(input: string): number {
  return new TextEncoder().encode(input).length;
}
