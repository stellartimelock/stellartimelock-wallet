import type { Vault } from "@/src/vault/contract";

export type SortKey = "time" | "amount" | "created";

/**
 * Returns a new array sorted per the dashboard rules:
 *
 *  1. Archived vaults are pinned to the very bottom (they have no live
 *     on-chain balance/unlock data, so sorting them alongside live vaults
 *     would be misleading).
 *  2. Withdrawn vaults are pinned ABOVE archived but BELOW any active
 *     locked/unlocked vault, regardless of `sort`.
 *  3. For the remaining (active) vaults:
 *     - "time"    → soonest unlock first; expired locks treated as 0 remaining.
 *     - "amount"  → largest balance first.
 *     - "created" → most recently created first.
 */
export function sortVaults(
  vaults: readonly Vault[],
  sort: SortKey,
  nowSec: number = Math.floor(Date.now() / 1000),
): Vault[] {
  // Pin order: live (locked/unlocked) → withdrawn → archived.
  // Assigning a numeric rank lets a single sort step honour both the
  // pinning rules and the chosen primary sort.
  const rank = (v: Vault): number => {
    if (v.status === "archived") return 2;
    if (v.status === "withdrawn") return 1;
    return 0;
  };
  const arr = [...vaults];
  arr.sort((a, b) => {
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    switch (sort) {
      case "amount":
        return b.balance - a.balance;
      case "created":
        return b.created_timestamp - a.created_timestamp;
      case "time":
      default: {
        const ra = Math.max(0, a.unlock_timestamp - nowSec);
        const rb = Math.max(0, b.unlock_timestamp - nowSec);
        return ra - rb;
      }
    }
  });
  return arr;
}
