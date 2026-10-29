// Tier caps — active vault limits and monthly deposit volume.
// Kept for backward-compatible imports; enforcement lives in src/tiers/.

import {
  canCreateVaultType,
  getCurrentTier,
  getMonthlyDepositLimit,
  getVaultLimit,
} from "@/src/tiers/tier-config";
import {
  checkTierMonthlyDepositLimit,
  checkTierVaultLimit,
  countActiveVaults,
} from "@/src/tiers/tier-limits";

/** @deprecated Prefer getVaultLimit() from tier-config. */
export const MAX_VAULTS = 10;

/** Caps are disabled for the exempt developer account. */
export async function isExemptUser(): Promise<boolean> {
  return false;
}

/**
 * Check total **active** vault count against the current tier limit.
 * Returns null if ok, or an error message if cap is exceeded.
 */
export async function checkVaultCap(walletPublicKey: string): Promise<string | null> {
  if (await isExemptUser()) return null;
  return checkTierVaultLimit(walletPublicKey, getCurrentTier());
}

/**
 * Check Time Gate (CoolingOff) is allowed on the current tier and under vault cap.
 */
export async function checkTimeGateCap(walletPublicKey: string): Promise<string | null> {
  if (await isExemptUser()) return null;
  if (!canCreateVaultType("CoolingOff")) {
    return "Cooling-Off requires Plus or higher. Upgrade to unlock it.";
  }
  return checkVaultCap(walletPublicKey);
}

/** @deprecated Use checkTimeGateCap */
export const checkCoolingOffCap = checkTimeGateCap;

/**
 * Check Dead Man's Switch is allowed on the current tier and under vault cap.
 */
export async function checkDmsCap(walletPublicKey: string): Promise<string | null> {
  if (await isExemptUser()) return null;
  if (!canCreateVaultType("DeadManSwitch")) {
    return "Dead Man's Switch requires Elite. Upgrade to unlock it.";
  }
  return checkVaultCap(walletPublicKey);
}

export const timeGateCapMessage =
  "Cooling-Off requires Plus or higher. Upgrade to unlock it.";
/** @deprecated Use timeGateCapMessage */
export const coolingOffCapMessage = timeGateCapMessage;
export const dmsCapMessage =
  "Dead Man's Switch requires Elite. Upgrade to unlock it.";

/** Free-tier monthly deposit default — prefer getMonthlyDepositLimit(). */
export const UNLOCK_INTERVALS_MONTHLY_CAP_USD = 1000;
/** @deprecated Use UNLOCK_INTERVALS_MONTHLY_CAP_USD */
export const VESTING_MONTHLY_CAP_USD = UNLOCK_INTERVALS_MONTHLY_CAP_USD;

/**
 * Check if a deposit amount (XLM) would exceed the tier monthly USD cap.
 */
export async function checkMonthlyDepositCap(
  walletPublicKey: string,
  amountXlm: number,
  xlmUsdRate: number,
): Promise<string | null> {
  if (await isExemptUser()) return null;
  return checkTierMonthlyDepositLimit(
    walletPublicKey,
    amountXlm,
    xlmUsdRate,
    getCurrentTier(),
  );
}

/**
 * Check Unlock Intervals (Vesting) amount against tier monthly deposit limit.
 * Sync fallback when wallet context is unavailable — uses per-deposit estimate.
 */
export function checkUnlockIntervalsAmountCap(
  amountXlm: number,
  xlmUsdRate: number,
): string | null {
  if (amountXlm <= 0) return null;
  if (!canCreateVaultType("Vesting")) {
    return "Vesting Schedule requires Pro or higher. Upgrade to unlock it.";
  }
  const limit = getMonthlyDepositLimit() ?? UNLOCK_INTERVALS_MONTHLY_CAP_USD;
  const usdValue = amountXlm * xlmUsdRate;
  if (usdValue > limit) {
    return `This deposit (≈$${Math.round(usdValue).toLocaleString()}) exceeds your $${limit.toLocaleString()} monthly vault deposit limit.`;
  }
  return null;
}

/** @deprecated Use checkUnlockIntervalsAmountCap */
export const checkVestingAmountCap = checkUnlockIntervalsAmountCap;

export { countActiveVaults, getVaultLimit };
