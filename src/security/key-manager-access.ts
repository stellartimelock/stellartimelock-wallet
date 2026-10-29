// Key Manager access control.
//
// Gate logic:
//   • Paid subscribers (Plus / Pro / Elite) → always allowed.
//   • Grandfathered users → anyone who opened Key Manager before the
//     subscription gate was introduced (1.6.2). We detect this by checking
//     whether entries exist in the store; if they do, the user was using
//     Key Manager before we gated it. We record a one-time timestamp so
//     subsequent checks are O(1) storage reads.
//   • New users without a subscription → see the subscribe screen.
//
// The grandfather flag is stored under KM_GRANDFATHER_KEY. Once written it
// is never cleared (even if the user later deletes all keys). Grandfathered
// users keep full access forever: they can add new keys for free.

import { storage } from "@/src/utils/storage";
import { listKeyEntries } from "@/src/security/key-manager-store";
import { getCurrentTier, hasTierAccess, hydrateTier } from "@/src/tiers/tier-config";

const KM_GRANDFATHER_KEY = "km_grandfather_v1";

export interface KmAccessResult {
  /** User may open the full Key Manager. */
  allowed: boolean;
  /** Reason the gate is open — useful for analytics / future messaging. */
  reason: "subscribed" | "grandfathered" | "blocked";
}

/** Persist the grandfather flag exactly once (non-destructive). */
async function setGrandfathered(): Promise<void> {
  const existing = await storage.getItem<string>(KM_GRANDFATHER_KEY, "");
  if (existing) return;
  await storage.setItem(KM_GRANDFATHER_KEY, String(Date.now()));
}

/** True if the grandfather flag was previously written. */
async function isGrandfathered(): Promise<boolean> {
  const v = await storage.getItem<string>(KM_GRANDFATHER_KEY, "");
  return Boolean(v);
}

/**
 * Determine whether the current user may open the full Key Manager.
 *
 * Side-effect: if the user has existing key entries (pre-gate usage), the
 * grandfather flag is written for them automatically.
 */
export async function checkKmAccess(): Promise<KmAccessResult> {
  // 1. Hydrate the tier in case it hasn't been fetched yet this session.
  await hydrateTier().catch(() => undefined);
  const tier = getCurrentTier();

  // 2. Paid subscribers always have access.
  if (hasTierAccess("plus", tier)) {
    // Also write the grandfather flag for paid users so they never lose access
    // if they downgrade later (preserve their history).
    void setGrandfathered().catch(() => undefined);
    return { allowed: true, reason: "subscribed" };
  }

  // 3. Check the stored grandfather flag.
  if (await isGrandfathered()) {
    return { allowed: true, reason: "grandfathered" };
  }

  // 4. Detect legacy usage: if entries exist in the store, the user was
  //    using Key Manager before the gate. Write the flag and allow access.
  try {
    const existing = await listKeyEntries();
    if (existing.length > 0) {
      await setGrandfathered();
      return { allowed: true, reason: "grandfathered" };
    }
  } catch {
    // If we can't read the store, don't accidentally block a grandfathered user.
    if (await isGrandfathered()) {
      return { allowed: true, reason: "grandfathered" };
    }
  }

  return { allowed: false, reason: "blocked" };
}

/**
 * Mark the current user as grandfathered explicitly.
 * Call after a successful in-app purchase so downgrade doesn't block access.
 */
export async function markGrandfathered(): Promise<void> {
  await setGrandfathered();
}
