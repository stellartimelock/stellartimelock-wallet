// Per-transaction and rolling 24-hour limits for outgoing tap-to-pay.
// Defaults are modest. The settings screen is the only place they change.

import {
  DEFAULT_DAILY_XLM,
  DEFAULT_PER_TX_XLM,
  MAX_LIMIT_XLM,
} from "./constants";
import { canonicalAmount, compareAmounts, parseAmountToStroops, stroopsToAmount } from "./money";

export interface TapLimits {
  perTxXlm: string;
  dailyXlm: string;
}

export const DEFAULT_TAP_LIMITS: TapLimits = {
  perTxXlm: DEFAULT_PER_TX_XLM,
  dailyXlm: DEFAULT_DAILY_XLM,
};

export type LimitCode = "invalid_amount" | "per_tx" | "daily";

export type LimitDecision =
  | { ok: true; spentToday: string; remaining: string }
  | {
      ok: false;
      code: LimitCode;
      message: string;
      spentToday: string;
      remaining: string;
    };

export function normalizeLimits(input: Partial<TapLimits> | null | undefined): TapLimits {
  const perTx = canonicalAmount(input?.perTxXlm ?? "") ?? DEFAULT_PER_TX_XLM;
  const daily = canonicalAmount(input?.dailyXlm ?? "") ?? DEFAULT_DAILY_XLM;
  const checked = assessLimitSettings(perTx, daily);
  if (!checked.ok) return { ...DEFAULT_TAP_LIMITS };
  return { perTxXlm: perTx, dailyXlm: daily };
}

export function assessLimitSettings(
  perTxXlm: string,
  dailyXlm: string,
): { ok: true; perTxXlm: string; dailyXlm: string } | { ok: false; message: string } {
  const perTx = canonicalAmount(perTxXlm);
  const daily = canonicalAmount(dailyXlm);
  if (!perTx || !daily) {
    return { ok: false, message: "Enter a positive XLM amount for each limit." };
  }
  const max = parseAmountToStroops(MAX_LIMIT_XLM);
  const perStroops = parseAmountToStroops(perTx);
  const dailyStroops = parseAmountToStroops(daily);
  if (max == null || perStroops == null || dailyStroops == null) {
    return { ok: false, message: "Enter a positive XLM amount for each limit." };
  }
  if (perStroops > max || dailyStroops > max) {
    return { ok: false, message: "Limits cannot be higher than 1,000,000 XLM." };
  }
  if (compareAmounts(perTx, daily) === 1) {
    return { ok: false, message: "The per-payment limit cannot be higher than the daily limit." };
  }
  return { ok: true, perTxXlm: perTx, dailyXlm: daily };
}

export function assessTapLimits(opts: {
  amount: string;
  limits: TapLimits;
  spentToday: string;
}): LimitDecision {
  const amount = canonicalAmount(opts.amount);
  const limits = normalizeLimits(opts.limits);
  const spentStroops = parseAmountToStroops(opts.spentToday) ?? 0n;
  const spentCanonical = stroopsToAmount(spentStroops);
  if (!amount) {
    return {
      ok: false,
      code: "invalid_amount",
      message: "Enter a positive XLM amount.",
      spentToday: spentCanonical,
      remaining: remainingToday(limits.dailyXlm, spentCanonical),
    };
  }
  if (compareAmounts(amount, limits.perTxXlm) === 1) {
    return {
      ok: false,
      code: "per_tx",
      message: `This payment is above the per-payment limit of ${limits.perTxXlm} XLM.`,
      spentToday: spentCanonical,
      remaining: remainingToday(limits.dailyXlm, spentCanonical),
    };
  }
  const next = (parseAmountToStroops(amount) ?? 0n) + spentStroops;
  const dailyStroops = parseAmountToStroops(limits.dailyXlm) ?? 0n;
  if (next > dailyStroops) {
    return {
      ok: false,
      code: "daily",
      message: `This payment would pass the daily limit of ${limits.dailyXlm} XLM.`,
      spentToday: spentCanonical,
      remaining: remainingToday(limits.dailyXlm, spentCanonical),
    };
  }
  return {
    ok: true,
    spentToday: spentCanonical,
    remaining: remainingToday(limits.dailyXlm, stroopsToAmount(next)),
  };
}

function remainingToday(daily: string, used: string): string {
  const left = (parseAmountToStroops(daily) ?? 0n) - (parseAmountToStroops(used) ?? 0n);
  if (left <= 0n) return "0.0000000";
  return stroopsToAmount(left);
}

export function isFirstTimeRecipient(opts: {
  destination: string;
  knownRecipients: readonly string[];
  savedAddresses: readonly string[];
  whitelistedDestinations?: readonly string[];
}): boolean {
  const dest = opts.destination.trim();
  if (!dest) return true;
  const known = new Set(
    [
      ...opts.knownRecipients,
      ...opts.savedAddresses,
      ...(opts.whitelistedDestinations ?? []),
    ].map((item) => item.trim()),
  );
  return !known.has(dest);
}
