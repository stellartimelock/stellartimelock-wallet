// Local subscription expiry store — offline gating by expiration date.
// No network billing yet; expiries are set locally (or left empty → Free).

import { isPermanentEliteAccount } from "@/src/tiers/permanent-elite";
import { storage } from "@/src/utils/storage";

export type PaidTierId = "plus" | "pro" | "elite";
export type EffectiveTierId = "free" | "plus" | "pro" | "elite";

const STORAGE_KEY = "xlm_vault_subscription_expiry_v1";

type ExpiryMap = Record<PaidTierId, string | null>;

const EMPTY: ExpiryMap = { plus: null, pro: null, elite: null };

/** In-memory cache so sync helpers work after hydrate. */
let cache: ExpiryMap = { ...EMPTY };
let hydrated = false;

function isPaidTierId(v: unknown): v is PaidTierId {
  return v === "plus" || v === "pro" || v === "elite";
}

function parseExpiryMap(raw: unknown): ExpiryMap {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const obj = raw as Record<string, unknown>;
  const next: ExpiryMap = { ...EMPTY };
  for (const tier of ["plus", "pro", "elite"] as const) {
    const v = obj[tier];
    if (typeof v === "string" && v.trim()) {
      const d = new Date(v);
      next[tier] = Number.isNaN(d.getTime()) ? null : d.toISOString();
    } else {
      next[tier] = null;
    }
  }
  return next;
}

async function persist(): Promise<void> {
  await storage.setItem(STORAGE_KEY, cache);
}

/** Load persisted expiry map. Call early from hydrateTier / app entry. */
export async function hydrateSubscriptions(): Promise<void> {
  const raw = await storage.getItem<ExpiryMap | null>(STORAGE_KEY, null);
  cache = parseExpiryMap(raw);
  hydrated = true;
}

export function isSubscriptionHydrated(): boolean {
  return hydrated;
}

/**
 * Sync read of stored expiry for a paid tier (null if never subscribed).
 * Does not treat permanent-Elite wallets specially — callers use getEffectiveTier.
 */
export function getSubscriptionExpiry(tier: PaidTierId): Date | null {
  if (!isPaidTierId(tier)) return null;
  const raw = cache[tier];
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Persist an expiry date for a paid tier. */
export async function setSubscriptionExpiry(
  tier: PaidTierId,
  expiryDate: Date,
): Promise<void> {
  if (!isPaidTierId(tier)) return;
  if (!(expiryDate instanceof Date) || Number.isNaN(expiryDate.getTime())) {
    return;
  }
  cache = { ...cache, [tier]: expiryDate.toISOString() };
  hydrated = true;
  await persist();
}

/** Clear the stored subscription for a paid tier. */
export async function clearSubscription(tier: PaidTierId): Promise<void> {
  if (!isPaidTierId(tier)) return;
  cache = { ...cache, [tier]: null };
  hydrated = true;
  await persist();
}

function isExpiryActive(expiry: Date | null, now: Date = new Date()): boolean {
  return expiry != null && expiry.getTime() > now.getTime();
}

export type SubscriptionStatus = "active" | "expired" | "not_subscribed";

/** UI helper: Active / Expired / Not Subscribed for a paid tier. */
export function getSubscriptionStatus(
  tier: PaidTierId,
  now: Date = new Date(),
): SubscriptionStatus {
  const expiry = getSubscriptionExpiry(tier);
  if (expiry == null) return "not_subscribed";
  return isExpiryActive(expiry, now) ? "active" : "expired";
}

/**
 * Highest valid tier from local expiry dates.
 * Permanent Elite accounts are checked first and ignore expiry.
 * Otherwise: Elite → Pro → Plus → Free.
 */
export function getEffectiveTier(publicKey?: string | null): EffectiveTierId {
  if (isPermanentEliteAccount(publicKey)) {
    return "elite";
  }
  const now = new Date();
  if (isExpiryActive(getSubscriptionExpiry("elite"), now)) return "elite";
  if (isExpiryActive(getSubscriptionExpiry("pro"), now)) return "pro";
  if (isExpiryActive(getSubscriptionExpiry("plus"), now)) return "plus";
  return "free";
}
