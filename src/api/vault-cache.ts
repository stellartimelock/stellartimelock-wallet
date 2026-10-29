// @CONTEXT: Soroban RPC providers only retain contract events for a limited window (24h-7d), so once create/deposit/extend events age out, the events fallback in soroban-client.ts:listVaults can't rebuild a vault; if simulateTransaction is also unreachable/parse-failing on Hermes, the vault would silently disappear. This cache persists every successful listVaults result to AsyncStorage and merges it with live reads so older vaults stay visible indefinitely. Fresh state always wins on overlap; cache-only vaults are kept as-is. Cache is per-device and intentionally not mirrored to the backend to preserve the non-custodial model — the contract still enforces real on-chain state on any write, so the worst case is a stale UI status, not a stale balance.

import { Vault } from "@/src/vault/contract";
import { storage } from "@/src/utils/storage";
import { getActiveDeployment } from "@/src/wallet/contract-config";

export { mergeVaults } from "@/src/api/vault-merge";

interface PersistedVaultSnapshot {
  /** Cache schema version — bump when the Vault interface changes. */
  schema: 1;
  /** Contract this snapshot belongs to. */
  contract_id: string;
  /** Owner G-address this snapshot belongs to. */
  owner: string;
  /** Wall-clock timestamp (ms) of the snapshot. */
  saved_at: number;
  /** Which read path produced the snapshot. */
  source: "simulate" | "events" | "merged";
  /** Canonical vault list. */
  vaults: Vault[];
}

function keyFor(owner: string): string {
  return `xlm_vault_cache:${getActiveDeployment().contractId}:${owner}`;
}

export async function loadCachedVaults(owner: string): Promise<Vault[]> {
  try {
    const snap = (await storage.getItem<PersistedVaultSnapshot | null>(
      keyFor(owner),
      null,
    )) as PersistedVaultSnapshot | null;
    if (!snap || snap.schema !== 1) return [];
    if (snap.owner !== owner) return [];
    if (snap.contract_id !== getActiveDeployment().contractId) return [];
    return Array.isArray(snap.vaults) ? snap.vaults : [];
  } catch {
    return [];
  }
}

export async function saveCachedVaults(
  owner: string,
  vaults: Vault[],
  source: PersistedVaultSnapshot["source"],
): Promise<void> {
  try {
    const snap: PersistedVaultSnapshot = {
      schema: 1,
      contract_id: getActiveDeployment().contractId,
      owner,
      saved_at: Date.now(),
      source,
      vaults,
    };
    await storage.setItem(keyFor(owner), snap);
  } catch {
    // Cache writes are best-effort.
  }
}

// @CONTEXT: called on disconnect/wallet reset so the next user's session doesn't inherit ghost vaults
export async function clearCachedVaults(owner: string): Promise<void> {
  try {
    await storage.removeItem(keyFor(owner));
  } catch {
    // ignore
  }
}
