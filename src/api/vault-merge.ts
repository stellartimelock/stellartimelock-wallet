import type { Vault } from "@/src/vault/contract";

// Fresh state wins on overlap. Cached-only vaults stay so a vault the
// phone already listed does not disappear when a backend is absent and
// the RPC read is empty.
export function mergeVaults(cached: Vault[], fresh: Vault[]): Vault[] {
  const byId = new Map<string, Vault>();
  for (const v of cached) byId.set(v.vault_id, v);
  for (const v of fresh) byId.set(v.vault_id, v);
  const merged = Array.from(byId.values());
  merged.sort((a, b) => b.created_timestamp - a.created_timestamp);
  return merged;
}
