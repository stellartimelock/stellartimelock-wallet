// Optional helper-spending allowance.
//
// This is a local earmark inside the one save file, not a second on-chain
// account and not a transaction. Freeze stops new set-asides. Sweep returns
// the earmarked XLM figure to the main balance on paper — it does not
// broadcast. A weekly USD cap resets each Monday (UTC).

import { addDays, isIsoDate, mondayOf } from "./dates";
import {
  addDecimal,
  compareDecimal,
  MoneyError,
  subDecimal,
  toUnits,
  fromUnits,
} from "./math";

export interface HelperAccount {
  enabled: boolean;
  /** Decimal USD cap for the current week. */
  weeklyLimitUsd: string;
  /** Monday (YYYY-MM-DD) that opened the tracked week. */
  weekStartedOn: string;
  spentUsd: string;
  frozen: boolean;
  /** XLM earmarked for helper spending. Sweep clears this. */
  allocatedXlm: string;
  updatedAt: number;
}

export function emptyHelper(today: string, now = Date.now()): HelperAccount {
  const day = isIsoDate(today) ? today : new Date(now).toISOString().slice(0, 10);
  return {
    enabled: false,
    weeklyLimitUsd: "0",
    weekStartedOn: mondayOf(day),
    spentUsd: "0",
    frozen: false,
    allocatedXlm: "0",
    updatedAt: now,
  };
}

/** Reset the spent counter when `today` falls outside the tracked week. */
export function rollWeek(helper: HelperAccount, today: string): HelperAccount {
  const start = mondayOf(today);
  if (helper.weekStartedOn === start) return helper;
  return {
    ...helper,
    weekStartedOn: start,
    spentUsd: "0",
    updatedAt: helper.updatedAt,
  };
}

export function weekRange(today: string): { start: string; end: string } {
  const start = mondayOf(today);
  return { start, end: addDays(start, 6) };
}

export function remainingUsd(helper: HelperAccount, today: string): string {
  const rolled = rollWeek(helper, today);
  if (!rolled.enabled) return "0";
  if (compareDecimal(rolled.spentUsd, rolled.weeklyLimitUsd) >= 0) return "0";
  return subDecimal(rolled.weeklyLimitUsd, rolled.spentUsd);
}

export function setHelperEnabled(
  helper: HelperAccount,
  enabled: boolean,
  weeklyLimitUsd: string,
  today: string,
  now = Date.now(),
): HelperAccount {
  const rolled = rollWeek(helper, today);
  let limit = rolled.weeklyLimitUsd;
  if (enabled) {
    const units = toUnits(weeklyLimitUsd);
    if (units <= 0n) throw new MoneyError("Weekly limit must be greater than zero.");
    limit = fromUnits(units);
  }
  return {
    ...rolled,
    enabled,
    weeklyLimitUsd: limit,
    updatedAt: now,
  };
}

export function setHelperFrozen(
  helper: HelperAccount,
  frozen: boolean,
  now = Date.now(),
): HelperAccount {
  return { ...helper, frozen, updatedAt: now };
}

/** Move XLM into the helper earmark. Local only — no transaction. */
export function allocateHelper(
  helper: HelperAccount,
  xlm: string,
  now = Date.now(),
): HelperAccount {
  const units = toUnits(xlm);
  if (units <= 0n) throw new MoneyError("Allocate at least one stroop.");
  return {
    ...helper,
    allocatedXlm: addDecimal(helper.allocatedXlm, fromUnits(units)),
    updatedAt: now,
  };
}

/**
 * Return earmarked XLM to the main balance on paper.
 * Does not build a payment and does not broadcast.
 */
export function sweepHelper(
  helper: HelperAccount,
  now = Date.now(),
): { helper: HelperAccount; sweptXlm: string } {
  const sweptXlm = helper.allocatedXlm;
  return {
    sweptXlm,
    helper: { ...helper, allocatedXlm: "0", updatedAt: now },
  };
}

export type ReserveResult =
  | { ok: true; helper: HelperAccount }
  | {
      ok: false;
      code: "disabled" | "frozen" | "over_limit";
      helper: HelperAccount;
    };

/**
 * Record a helper spend against the weekly cap. Call only after the user
 * has approved. Never broadcasts.
 */
export function reserveHelperSpend(
  helper: HelperAccount,
  usd: string,
  xlm: string | null,
  today: string,
  now = Date.now(),
): ReserveResult {
  const rolled = rollWeek(helper, today);
  if (!rolled.enabled) return { ok: false, code: "disabled", helper: rolled };
  if (rolled.frozen) return { ok: false, code: "frozen", helper: rolled };
  const amount = fromUnits(toUnits(usd));
  if (toUnits(amount) <= 0n) return { ok: false, code: "over_limit", helper: rolled };
  if (compareDecimal(amount, remainingUsd(rolled, today)) > 0) {
    return { ok: false, code: "over_limit", helper: rolled };
  }
  let allocated = rolled.allocatedXlm;
  if (xlm != null && compareDecimal(allocated, "0") > 0) {
    const draw = compareDecimal(xlm, allocated) > 0 ? allocated : fromUnits(toUnits(xlm));
    allocated = subDecimal(allocated, draw);
  }
  return {
    ok: true,
    helper: {
      ...rolled,
      spentUsd: addDecimal(rolled.spentUsd, amount),
      allocatedXlm: allocated,
      updatedAt: now,
    },
  };
}
