// Exact XLM amount math.
//
// Stellar amounts are integers of 1/10^7 XLM (stroops). Rates and dollar
// amounts enter as decimal strings and stay in integer units so a top-up
// quote cannot drift through binary floating point. Network fees are
// stroops added on top of the principal — the transfer itself is the
// exact XLM worth of the requested dollars.

const SCALE = 7;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

/** 1 XLM = 10,000,000 stroops. */
export const STROOPS_PER_XLM = SCALE_FACTOR;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Round-half-up integer division (ties away from zero). */
export function divRoundHalfUp(numer: bigint, denom: bigint): bigint {
  if (denom === 0n) throw new MoneyError("Division by zero.");
  const neg = (numer < 0n) !== (denom < 0n);
  const a = numer < 0n ? -numer : numer;
  const b = denom < 0n ? -denom : denom;
  const q = a / b;
  const r = a % b;
  const rounded = r * 2n >= b ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/**
 * Parse a non-negative decimal into integer units of 10^-scale.
 * Extra digits past `scale` are round-half-up, not truncated.
 */
export function toUnits(input: string, scale = SCALE): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new MoneyError("Amount must be a positive decimal.");
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > scale) {
    const keep = frac.slice(0, scale);
    const extra = frac.slice(scale);
    let units =
      BigInt(whole) * 10n ** BigInt(scale) + BigInt(keep.padEnd(scale, "0"));
    if (extra[0] >= "5") units += 1n;
    return units;
  }
  const padded = (frac || "").padEnd(scale, "0");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(padded || "0");
}

/** Format integer units as a decimal string with trailing zeros removed. */
export function fromUnits(units: bigint, scale = SCALE): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const factor = 10n ** BigInt(scale);
  const whole = abs / factor;
  const frac = (abs % factor).toString().padStart(scale, "0");
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed.length > 0 ? `${whole.toString()}.${trimmed}` : whole.toString();
  return neg ? `-${body}` : body;
}

/** Normalize a finite non-negative number to a decimal string. */
export function decimalFromNumber(n: number, scale = SCALE): string {
  if (!Number.isFinite(n) || n < 0) {
    throw new MoneyError("Amount must be a finite, non-negative number.");
  }
  const [whole, frac] = n.toFixed(scale).split(".");
  const trimmed = (frac ?? "").replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function compareDecimal(a: string, b: string): number {
  const d = toUnits(a) - toUnits(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function addDecimal(a: string, b: string): string {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function subDecimal(a: string, b: string): string {
  const d = toUnits(a) - toUnits(b);
  if (d < 0n) throw new MoneyError("Subtraction would go negative.");
  return fromUnits(d);
}

/** Format a decimal as USD with 2 fraction digits (half-up). */
export function formatUsd(amount: string): string {
  const units = toUnits(amount);
  const cents = divRoundHalfUp(units, 100_000n);
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${frac}`;
}

export interface XlmQuote {
  /** Dollar value of the XLM principal, when a rate was supplied. */
  amountUsd: string | null;
  rateUsdPerXlm: string | null;
  /** Exact XLM principal that will be transferred. */
  amountXlm: string;
  feeXlm: string;
  /** Principal plus network fee. */
  totalXlm: string;
  amountStroops: string;
  feeStroops: string;
  feeIsEstimate: boolean;
}

function feeUnits(feeStroops: number | string | null): { stroops: bigint; estimate: boolean } {
  if (feeStroops == null) {
    return { stroops: 100n, estimate: true };
  }
  const raw = typeof feeStroops === "number" ? String(feeStroops) : feeStroops.trim();
  if (!/^\d+$/.test(raw)) throw new MoneyError("Fee must be a whole number of stroops.");
  return { stroops: BigInt(raw), estimate: false };
}

function assertSendable(stroops: bigint): void {
  if (stroops <= 0n) throw new MoneyError("Amount is smaller than one stroop.");
  // Same ceiling the Send screen uses.
  const max = toUnits("1000000000");
  if (stroops > max) throw new MoneyError("Amount exceeds 1,000,000,000 XLM.");
}

/**
 * Dollar amount → exact XLM principal at `rateUsdPerXlm`, plus fee.
 * The principal is round-half-up to the nearest stroop.
 */
export function quoteUsdInXlm(
  usd: string,
  rateUsdPerXlm: string,
  feeStroops: number | string | null = null,
): XlmQuote {
  const usdUnits = toUnits(usd);
  const rateUnits = toUnits(rateUsdPerXlm);
  if (usdUnits === 0n) throw new MoneyError("Amount must be greater than zero.");
  if (rateUnits === 0n) throw new MoneyError("Rate must be greater than zero.");
  const stroops = divRoundHalfUp(usdUnits * SCALE_FACTOR, rateUnits);
  assertSendable(stroops);
  const fee = feeUnits(feeStroops);
  return {
    amountUsd: fromUnits(usdUnits),
    rateUsdPerXlm: fromUnits(rateUnits),
    amountXlm: fromUnits(stroops),
    feeXlm: fromUnits(fee.stroops),
    totalXlm: fromUnits(stroops + fee.stroops),
    amountStroops: stroops.toString(),
    feeStroops: fee.stroops.toString(),
    feeIsEstimate: fee.estimate,
  };
}

/** Known XLM amount → quote, with an optional USD equivalent. */
export function quoteXlm(
  xlm: string,
  rateUsdPerXlm: string | null,
  feeStroops: number | string | null = null,
): XlmQuote {
  const stroops = toUnits(xlm);
  assertSendable(stroops);
  const fee = feeUnits(feeStroops);
  let amountUsd: string | null = null;
  let rate: string | null = null;
  if (rateUsdPerXlm != null && rateUsdPerXlm.trim() !== "") {
    const rateUnits = toUnits(rateUsdPerXlm);
    if (rateUnits === 0n) throw new MoneyError("Rate must be greater than zero.");
    rate = fromUnits(rateUnits);
    amountUsd = fromUnits(divRoundHalfUp(stroops * rateUnits, SCALE_FACTOR));
  }
  return {
    amountUsd,
    rateUsdPerXlm: rate,
    amountXlm: fromUnits(stroops),
    feeXlm: fromUnits(fee.stroops),
    totalXlm: fromUnits(stroops + fee.stroops),
    amountStroops: stroops.toString(),
    feeStroops: fee.stroops.toString(),
    feeIsEstimate: fee.estimate,
  };
}

/**
 * Number passed to `broadcastPayment`, which immediately `toFixed(7)`s it.
 * Built from stroops so the 7-decimal string round-trips.
 */
export function xlmToBroadcastNumber(xlm: string): number {
  const stroops = toUnits(xlm);
  assertSendable(stroops);
  return Number(stroops) / 10_000_000;
}
