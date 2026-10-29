// Persisted prefs for the Advanced Settings screen.
// Multi-asset create opt-in + optional Soroban RPC override for advanced vaults.

import { storage } from "@/src/utils/storage";

import { isHttpsRpcUrl } from "./rpc-url";

export { isHttpsRpcUrl };

const MULTI_ASSET_KEY = "advanced.multiAssetCreateEnabled";
const RPC_OVERRIDE_KEY = "advanced.rpcOverride";

let rpcOverrideCache: string | null | undefined = undefined;

/** Multi-asset create defaults ON. Only an explicit `false` turns it off. */
export async function getMultiAssetCreateEnabled(): Promise<boolean> {
  const v = await storage.getItem<boolean | null>(MULTI_ASSET_KEY, null);
  return v !== false;
}

export async function setMultiAssetCreateEnabled(enabled: boolean): Promise<void> {
  await storage.setItem(MULTI_ASSET_KEY, enabled);
}

export async function hydrateRpcOverride(): Promise<string | null> {
  const raw = await storage.getItem<string | null>(RPC_OVERRIDE_KEY, null);
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const cleaned = isHttpsRpcUrl(trimmed) ? trimmed : null;
  if (trimmed && !cleaned) {
    await storage.removeItem(RPC_OVERRIDE_KEY);
  }
  rpcOverrideCache = cleaned;
  return cleaned;
}

export function getRpcOverrideSync(): string | null {
  return rpcOverrideCache ?? null;
}

export async function setRpcOverride(url: string | null): Promise<void> {
  const trimmed = typeof url === "string" ? url.trim() : "";
  const cleaned = isHttpsRpcUrl(trimmed) ? trimmed : null;
  rpcOverrideCache = cleaned;
  if (cleaned) {
    await storage.setItem(RPC_OVERRIDE_KEY, cleaned);
  } else {
    await storage.removeItem(RPC_OVERRIDE_KEY);
  }
}
