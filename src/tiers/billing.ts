// Paid tiers are not launched, so the wallet ships without Google Play
// Billing (react-native-iap was removed for the open-source build).
// These no-op functions keep the call sites working. Re-add a store-specific
// billing module behind a build flavor if paid tiers ever launch.

import type { PaidTierId } from "@/src/tiers/subscription-store";

export const PRODUCT_IDS = {
  plus: "plus_monthly",
  pro: "pro_monthly",
  elite: "elite_monthly",
} as const satisfies Record<PaidTierId, string>;

export const ALL_PRODUCT_SKUS: readonly string[] = [
  PRODUCT_IDS.plus,
  PRODUCT_IDS.pro,
  PRODUCT_IDS.elite,
];

export type BillingProduct = {
  id: string;
  title: string;
  description: string;
  displayPrice: string;
  raw: unknown;
};

export type RestoreResult = {
  ok: boolean;
  restoredTiers: PaidTierId[];
  message: string;
};

export function isUserCancelledPurchase(_err: unknown): boolean {
  return false;
}

export function billingErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export async function initializeBilling(): Promise<boolean> {
  return false;
}

export async function getProducts(): Promise<BillingProduct[]> {
  return [];
}

export async function handlePurchaseResult(
  _purchase: unknown,
): Promise<PaidTierId | null> {
  return null;
}

export async function purchaseSubscription(_tier: PaidTierId): Promise<void> {
  throw new Error("Subscriptions are not available in this version");
}

export async function restorePurchases(): Promise<RestoreResult> {
  return {
    ok: false,
    restoredTiers: [],
    message: "Subscriptions are not available in this version",
  };
}

export function listenForSubscriptionUpdates(
  _onUpdate?: () => void,
): () => void {
  return () => {};
}

export async function endBilling(): Promise<void> {
  /* no-op */
}
