// Persist which parts of the app the biometric unlock gate applies to.
// Scope is a UX gate only — it does not encrypt data (see biometric.ts).

import { storage } from "@/src/utils/storage";

export type LockScope =
  | "off"
  | "entire_app"
  | "wallet_only"
  | "notebook_only"
  | "vaults_only"
  | "custom";

// Custom scope granularity — sub-flags that turn individual gates on.
// Only consulted when `scope === "custom"`.
export interface CustomLockFlags {
  wallet: boolean;
  vaults: boolean;
  notes: boolean;
  bills: boolean;
  settings: boolean;
}

export const DEFAULT_CUSTOM_FLAGS: CustomLockFlags = {
  wallet: false,
  vaults: false,
  notes: false,
  bills: false,
  settings: false,
};

const SCOPE_KEY = "xlm_vault_lock_scope_v1";
const CUSTOM_KEY = "xlm_vault_lock_custom_v1";

export async function readLockScope(): Promise<LockScope> {
  const raw = (await storage.getItem<string>(SCOPE_KEY, "off")) ?? "off";
  const valid: LockScope[] = [
    "off",
    "entire_app",
    "wallet_only",
    "notebook_only",
    "vaults_only",
    "custom",
  ];
  return (valid as string[]).includes(raw) ? (raw as LockScope) : "off";
}

export async function writeLockScope(next: LockScope): Promise<void> {
  await storage.setItem(SCOPE_KEY, next);
}

export async function readCustomFlags(): Promise<CustomLockFlags> {
  const raw = await storage.getItem<CustomLockFlags>(
    CUSTOM_KEY,
    DEFAULT_CUSTOM_FLAGS,
  );
  return raw ?? DEFAULT_CUSTOM_FLAGS;
}

export async function writeCustomFlags(next: CustomLockFlags): Promise<void> {
  await storage.setItem(CUSTOM_KEY, next);
}

/**
 * Convenience — should the given surface be behind a biometric gate?
 * Returns true if biometric is enrolled AND scope matches.
 * NOTE: this is used purely for the UX gate; encryption keys are
 * independent (see `biometric.ts`).
 */
export async function shouldGate(
  surface: keyof CustomLockFlags,
  bioEnrolled: boolean,
): Promise<boolean> {
  if (!bioEnrolled) return false;
  const scope = await readLockScope();
  if (scope === "off") return false;
  if (scope === "entire_app") return true;
  if (scope === "wallet_only") return surface === "wallet";
  if (scope === "notebook_only") return surface === "notes" || surface === "bills";
  if (scope === "vaults_only") return surface === "vaults";
  if (scope === "custom") {
    const flags = await readCustomFlags();
    return flags[surface];
  }
  return false;
}
