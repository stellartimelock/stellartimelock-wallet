// Runtime enforcement for tier vault-count and monthly deposit limits.

import { api } from "@/src/api/client";
import {
  getCurrentTier,
  getMonthlyDepositLimit,
  getVaultLimit,
  monthlyDepositUpgradeMessage,
  resolveTierForWallet,
  vaultLimitUpgradeMessage,
  type TierId,
} from "@/src/tiers/tier-config";
import { listAdvancedVaults } from "@/src/wallet/advanced-vaults";
import type { AdvancedVaultRecord } from "@/src/wallet/advanced-vaults/client";
import { stroopsToFloat } from "@/src/wallet/advanced-vaults";
import { listBetaVaults, type BetaVaultRecord } from "@/src/wallet/multi-asset-beta";

function countActiveStandard(vaults: { status?: string }[]): number {
  return vaults.filter(
    (v) => v.status === "locked" || v.status === "unlocked",
  ).length;
}

function countActiveAdvanced(vaults: AdvancedVaultRecord[]): number {
  return vaults.filter((v) => !v.withdrawn && !v.claimedByBackup).length;
}

function countActiveBeta(vaults: BetaVaultRecord[]): number {
  return vaults.filter((v) => !v.withdrawn).length;
}

export async function countActiveVaults(walletPublicKey: string): Promise<number> {
  const [standard, advanced, beta] = await Promise.all([
    api.listVaults(walletPublicKey).catch(() => [] as { status?: string }[]),
    listAdvancedVaults(walletPublicKey).catch(() => [] as AdvancedVaultRecord[]),
    listBetaVaults(walletPublicKey).catch(() => [] as BetaVaultRecord[]),
  ]);
  return (
    countActiveStandard(standard) +
    countActiveAdvanced(advanced) +
    countActiveBeta(beta)
  );
}

/**
 * Check active vault count against the current tier limit.
 * Returns null if ok, or an upgrade message if blocked.
 */
export async function checkTierVaultLimit(
  walletPublicKey: string,
  tier: TierId = getCurrentTier(),
): Promise<string | null> {
  // Permanent Elite override applies per-wallet — the dev wallet is
  // never capped regardless of the test tier selector.
  tier = resolveTierForWallet(tier, walletPublicKey);
  const limit = getVaultLimit(tier);
  if (limit == null) return null;
  try {
    const total = await countActiveVaults(walletPublicKey);
    if (total >= limit) {
      return vaultLimitUpgradeMessage(total, tier);
    }
    return null;
  } catch {
    return "Couldn't check vault limit. Try again.";
  }
}

function monthBoundsMs(now = new Date()): { startSec: number; endSec: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    startSec: Math.floor(start.getTime() / 1000),
    endSec: Math.floor(end.getTime() / 1000),
  };
}

/**
 * Sum vault deposit volume (USD) in the current calendar month.
 * Includes standard create/deposit txs, advanced initial locks, and multi-asset creates.
 */
export async function getMonthlyDepositVolumeUsd(
  walletPublicKey: string,
  xlmUsdRate: number,
): Promise<number> {
  const rate = Number.isFinite(xlmUsdRate) && xlmUsdRate > 0 ? xlmUsdRate : 0;
  const { startSec, endSec } = monthBoundsMs();

  const [txs, advanced, beta] = await Promise.all([
    api.allTransactions(walletPublicKey).catch(() => [] as {
      kind: string;
      amount: number;
      timestamp: number;
    }[]),
    listAdvancedVaults(walletPublicKey).catch(() => [] as AdvancedVaultRecord[]),
    listBetaVaults(walletPublicKey).catch(() => [] as BetaVaultRecord[]),
  ]);

  let xlm = 0;

  for (const tx of txs) {
    if (tx.kind !== "create" && tx.kind !== "deposit") continue;
    const ts = Number(tx.timestamp) || 0;
    if (ts < startSec || ts >= endSec) continue;
    const amt = Number(tx.amount);
    if (Number.isFinite(amt) && amt > 0) xlm += amt;
  }

  // Advanced vaults are not always mirrored in standard txs — count initial lock.
  for (const v of advanced) {
    if (v.isBeneficiary) continue;
    if (v.createdTimestamp < startSec || v.createdTimestamp >= endSec) continue;
    const locked = stroopsToFloat(v.totalLockedAmount > 0n ? v.totalLockedAmount : v.balance);
    if (locked > 0) xlm += locked;
  }

  for (const v of beta) {
    if (v.createdTimestamp < startSec || v.createdTimestamp >= endSec) continue;
    // Beta balances are in stroops-like 1e7 units for SEP-41 tokens.
    // Treat native-denominated amounts as XLM-equivalent for cap purposes.
    const amountFloat = Number(v.balance) / 10_000_000;
    if (Number.isFinite(amountFloat) && amountFloat > 0) xlm += amountFloat;
  }

  return xlm * rate;
}

/**
 * Check whether adding `additionalXlm` would exceed the monthly deposit cap.
 * Returns null if ok, or an upgrade message if blocked.
 */
export async function checkTierMonthlyDepositLimit(
  walletPublicKey: string,
  additionalXlm: number,
  xlmUsdRate: number,
  tier: TierId = getCurrentTier(),
): Promise<string | null> {
  // Permanent Elite override applies per-wallet — the dev wallet is
  // never deposit-capped regardless of the test tier selector.
  tier = resolveTierForWallet(tier, walletPublicKey);
  const limit = getMonthlyDepositLimit(tier);
  if (limit == null) return null;
  if (!Number.isFinite(additionalXlm) || additionalXlm <= 0) return null;
  const rate = Number.isFinite(xlmUsdRate) && xlmUsdRate > 0 ? xlmUsdRate : 0;
  if (rate <= 0) {
    // Without a rate we can't enforce USD caps fairly — allow and rely on vault limit.
    return null;
  }
  try {
    const used = await getMonthlyDepositVolumeUsd(walletPublicKey, rate);
    const next = used + additionalXlm * rate;
    if (next > limit + 0.01) {
      return monthlyDepositUpgradeMessage(used, tier);
    }
    return null;
  } catch {
    return "Couldn't check monthly deposit limit. Try again.";
  }
}
