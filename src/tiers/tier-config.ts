// Subscription tier limits — vault count, monthly deposit volume, and vault types.
// FREE LAUNCH — all users get Elite. Re-enable gating when subscriptions go live.
// subscription-store remains intact but is not used for gating.
// The Settings test-tier switcher remains for the DEV Elite wallet only.

// ============================================================================
// BACKLOG — "Compare Tiers" page (NOT IMPLEMENTED — do not build yet)
// ----------------------------------------------------------------------------
// Create a "Compare Tiers" page accessible from Settings or the tier buttons
// (Plus / Pro / Elite on the wallet home screen).
//
// The page should render a comparison chart of Free vs Plus vs Pro vs Elite
// with the following columns/rows:
//   - Vault types
//   - Vault limits
//   - Monthly deposit limits
//   - Key manager
//   - Multi-wallet
//   - Price
//
// All tier data already lives in this module (TIER_CONFIGS: vaultLimit,
// monthlyDepositLimitUsd, vaultTypes, priceLabel). The "Key manager" and
// "Multi-wallet" columns do NOT yet exist in TierConfig and will need new
// fields (e.g. `keyManager: string` and `multiWallet: string` feature flags)
// to be added when this is implemented.
// ============================================================================

import { storage } from "@/src/utils/storage";
import {
  DEV_ELITE_WALLET_PUBLIC_KEY,
  PERMANENT_ELITE_ACCOUNTS,
  PERMANENT_ELITE_WALLETS,
  isPermanentEliteAccount,
  resolvePermanentEliteTier,
} from "@/src/tiers/permanent-elite";
import { hydrateSubscriptions } from "@/src/tiers/subscription-store";

export {
  DEV_ELITE_WALLET_PUBLIC_KEY,
  PERMANENT_ELITE_ACCOUNTS,
  PERMANENT_ELITE_WALLETS,
  isPermanentEliteAccount,
};

export type TierId = "free" | "plus" | "pro" | "elite";

/** Canonical vault types used for tier gating. */
export type TierVaultType =
  | "TimeLock"
  | "CoolingOff"
  | "Vesting"
  | "MultiAsset"
  | "DeadManSwitch"
  | "MultiSig"
  | "MultiAssetVesting"
  | "HTLC";

/** Vault types shown in UI but not yet creatable (until their contract ships). */
export const COMING_SOON_VAULT_TYPES: readonly TierVaultType[] = [];

export function isVaultTypeComingSoon(type: TierVaultType): boolean {
  return (COMING_SOON_VAULT_TYPES as readonly string[]).includes(type);
}

export interface TierConfig {
  id: TierId;
  label: string;
  /** Monthly price shown in upgrade copy. */
  priceLabel: string;
  /** Max active vaults. null = unlimited. */
  vaultLimit: number | null;
  /** Max monthly vault deposit volume in USD. null = unlimited. */
  monthlyDepositLimitUsd: number | null;
  vaultTypes: readonly TierVaultType[];
  /** Short dashboard pitch for upgrade prompts. */
  dashboardPitch: string;
}

export const TIER_ORDER: readonly TierId[] = ["free", "plus", "pro", "elite"] as const;

export const TIER_CONFIGS: Record<TierId, TierConfig> = {
  free: {
    id: "free",
    label: "Free",
    priceLabel: "$0",
    vaultLimit: 10,
    monthlyDepositLimitUsd: 1_000,
    vaultTypes: ["TimeLock"],
    dashboardPitch: "Browse mode — see what's available",
  },
  plus: {
    id: "plus",
    label: "Plus",
    priceLabel: "$5/mo",
    vaultLimit: 25,
    monthlyDepositLimitUsd: 10_000,
    vaultTypes: ["TimeLock", "CoolingOff"],
    dashboardPitch: "Plus dashboard with monitoring",
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceLabel: "$20/mo",
    vaultLimit: 100,
    monthlyDepositLimitUsd: 50_000,
    vaultTypes: [
      "TimeLock",
      "CoolingOff",
      "Vesting",
      "MultiAsset",
      "MultiSig",
      "MultiAssetVesting",
    ],
    dashboardPitch: "Pro dashboard with vault creation",
  },
  elite: {
    id: "elite",
    label: "Elite",
    priceLabel: "$75/mo",
    vaultLimit: null,
    monthlyDepositLimitUsd: null,
    // Elite includes all Pro types (incl. Multi-Sig + Multi-Asset Vesting)
    // plus Dead Man's Switch and HTLC.
    vaultTypes: [
      "TimeLock",
      "CoolingOff",
      "Vesting",
      "MultiAsset",
      "MultiSig",
      "MultiAssetVesting",
      "DeadManSwitch",
      "HTLC",
    ],
    dashboardPitch: "Elite dashboard with vault creation · institutional desk",
  },
};

const TIER_STORAGE_KEY = "xlm_vault_test_tier_v1";

/** In-memory cache so sync helpers work after hydrate. */
let cachedTier: TierId = "free";
let hydrated = false;

/**
 * Active wallet public key, mirrored from the wallet book so the permanent
 * Elite override can resolve per-wallet without any session.tsx changes.
 * Updated in src/wallet/wallet-book.ts (loadBook / setActiveWallet /
 * removeWallet / clearBook).
 */
let activeWalletPublicKey: string | null = null;

/** Track the active wallet so tier resolution can apply the Elite override. */
export function setActiveWalletPublicKeyForTier(
  publicKey: string | null,
): void {
  activeWalletPublicKey = (publicKey || "").trim().toUpperCase() || null;
}

/** True when the public key is one of the permanent Elite accounts. */
export function isPermanentEliteWallet(
  publicKey: string | null | undefined,
): boolean {
  return isPermanentEliteAccount(publicKey);
}

/**
 * True only for the DEV Elite wallet — the only key that may show the
 * Settings test-tier switcher and override getEffectiveTier for QA.
 */
export function isDevEliteWallet(
  publicKey: string | null | undefined,
): boolean {
  const pk = (publicKey || "").trim().toUpperCase();
  if (!pk) return false;
  return pk === DEV_ELITE_WALLET_PUBLIC_KEY.trim().toUpperCase();
}

/**
 * Apply the permanent Elite override to a tier for a specific account.
 * Checked before vault-count and monthly deposit limits, so a listed
 * account cannot be capped by a lower test tier or subscription.
 */
export function resolveTierForWallet(
  tier: TierId,
  publicKey?: string | null,
): TierId {
  return resolvePermanentEliteTier(tier, publicKey);
}

function isTierId(v: unknown): v is TierId {
  return v === "free" || v === "plus" || v === "pro" || v === "elite";
}

/**
 * Load subscription expiries + (for the DEV wallet) the test-tier override.
 * Call early from Settings / app entry.
 * Unset test-tier storage defaults to Elite so the DEV wallet keeps permanent
 * Elite until the switcher is used.
 */
export async function hydrateTier(publicKey?: string | null): Promise<TierId> {
  await hydrateSubscriptions();
  const raw = await storage.getItem<string | null>(TIER_STORAGE_KEY, null);
  cachedTier = isTierId(raw) ? raw : "elite";
  hydrated = true;
  return getCurrentTier(publicKey);
}

/**
 * Persist test tier selection for the DEV Elite wallet switcher only.
 * Does not affect subscription expiries for normal users.
 */
export async function setTestTier(tier: TierId): Promise<void> {
  cachedTier = tier;
  hydrated = true;
  await storage.setItem(TIER_STORAGE_KEY, tier);
}

/**
 * FREE LAUNCH — all users get Elite. Re-enable gating when subscriptions go live.
 * subscription-store.getEffectiveTier is kept intact but unused for gating.
 *
 * Permanent Elite accounts are resolved first so a later subscription,
 * balance, or time check cannot downgrade them.
 */
export function getEffectiveTier(publicKey?: string | null): TierId {
  if (isPermanentEliteAccount(publicKey)) return "elite";
  return "elite";
}

/**
 * Sync read of current tier. Defaults to Elite until hydrated.
 * When `publicKey` is omitted, the active wallet public key mirrored from
 * the wallet book is used (see setActiveWalletPublicKeyForTier).
 *
 * DEV Elite wallet: honors the test-tier switcher so every plan can be QA'd.
 * Everyone else: Elite (free launch). Re-enable subscription-store gating
 * when paid tiers go live.
 */
export function getCurrentTier(publicKey?: string | null): TierId {
  const pk = publicKey ?? activeWalletPublicKey;
  // QA switcher: the dev wallet only. Every other permanent Elite account
  // stays Elite and skips subscription / balance / time gating.
  if (isDevEliteWallet(pk) && hydrated) {
    return cachedTier;
  }
  if (isPermanentEliteAccount(pk)) {
    return "elite";
  }
  return getEffectiveTier(pk);
}

export function getTierConfig(tier: TierId = getCurrentTier()): TierConfig {
  return TIER_CONFIGS[tier];
}

export function getVaultLimit(tier: TierId = getCurrentTier()): number | null {
  return TIER_CONFIGS[tier].vaultLimit;
}

export function getMonthlyDepositLimit(
  tier: TierId = getCurrentTier(),
): number | null {
  return TIER_CONFIGS[tier].monthlyDepositLimitUsd;
}

export function canCreateVaultType(
  type: TierVaultType,
  tier: TierId = getCurrentTier(),
): boolean {
  if (isVaultTypeComingSoon(type)) return false;
  return TIER_CONFIGS[tier].vaultTypes.includes(type);
}

export function getAccessibleVaultTypes(
  tier: TierId = getCurrentTier(),
): readonly TierVaultType[] {
  return TIER_CONFIGS[tier].vaultTypes;
}

export function tierRank(tier: TierId): number {
  return TIER_ORDER.indexOf(tier);
}

/** True when the user's tier is at least as high as `required`. */
export function hasTierAccess(required: TierId, current: TierId = getCurrentTier()): boolean {
  return tierRank(current) >= tierRank(required);
}

/** Next paid tier for upgrade copy, or null if already Elite. */
export function nextUpgradeTier(tier: TierId = getCurrentTier()): TierId | null {
  const i = tierRank(tier);
  if (i < 0 || i >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[i + 1] ?? null;
}

export function vaultLimitUpgradeMessage(
  currentCount: number,
  tier: TierId = getCurrentTier(),
): string {
  const limit = getVaultLimit(tier);
  if (limit == null) {
    return `You have ${currentCount} active vaults.`;
  }
  const next = nextUpgradeTier(tier);
  if (!next) {
    return `You've reached your vault limit (${limit}).`;
  }
  const nextCfg = TIER_CONFIGS[next];
  const nextLimit =
    nextCfg.vaultLimit == null ? "unlimited" : String(nextCfg.vaultLimit);
  return `You've reached your ${limit} vault limit. Upgrade to ${nextCfg.label} for ${nextLimit} vaults.`;
}

export function monthlyDepositUpgradeMessage(
  usedUsd: number,
  tier: TierId = getCurrentTier(),
): string {
  const limit = getMonthlyDepositLimit(tier);
  if (limit == null) {
    return `Monthly deposits: $${Math.round(usedUsd).toLocaleString()}.`;
  }
  const next = nextUpgradeTier(tier);
  if (!next) {
    return `You've reached your $${limit.toLocaleString()} monthly deposit limit.`;
  }
  const nextCfg = TIER_CONFIGS[next];
  const nextLimit =
    nextCfg.monthlyDepositLimitUsd == null
      ? "no deposit limit"
      : `$${nextCfg.monthlyDepositLimitUsd.toLocaleString()} monthly`;
  return `You've reached your $${limit.toLocaleString()} monthly vault deposit limit. Upgrade to ${nextCfg.label} for ${nextLimit}.`;
}

export function vaultTypeUpgradeMessage(type: TierVaultType): string {
  const unlockTier = TIER_ORDER.find((t) =>
    TIER_CONFIGS[t].vaultTypes.includes(type),
  );
  const label = VAULT_TYPE_LABELS[type];
  if (!unlockTier || unlockTier === "free") {
    return `${label} is not available on your plan.`;
  }
  return `${label} requires ${TIER_CONFIGS[unlockTier].label}. Upgrade to unlock it.`;
}

export const VAULT_TYPE_LABELS: Record<TierVaultType, string> = {
  TimeLock: "Time-Lock",
  CoolingOff: "Cooling-Off",
  Vesting: "Vesting Schedule",
  MultiAsset: "Multi-Asset",
  DeadManSwitch: "Dead Man's Switch",
  MultiSig: "Multi-Sig",
  MultiAssetVesting: "Multi-Asset Vesting",
  HTLC: "HTLC",
};

/** Dashboard tab definitions per paid tier. */
export const TIER_DASHBOARD_TABS: Record<
  Exclude<TierId, "free">,
  { key: TierVaultType; label: string }[]
> = {
  plus: [
    { key: "TimeLock", label: "Time-Lock" },
    { key: "CoolingOff", label: "Cooling-Off" },
  ],
  pro: [
    { key: "TimeLock", label: "Time-Lock" },
    { key: "CoolingOff", label: "Cooling-Off" },
    { key: "Vesting", label: "Vesting" },
    { key: "MultiAsset", label: "Multi-Asset" },
    { key: "MultiSig", label: "Multi-Sig" },
    { key: "MultiAssetVesting", label: "Multi-Asset Vesting" },
  ],
  // Elite dashboards show EVERY vault type, including the Elite-exclusive
  // kinds (Dead Man's Switch + HTLC) and all Pro types.
  elite: [
    { key: "TimeLock", label: "Time-Lock" },
    { key: "CoolingOff", label: "Cooling-Off" },
    { key: "Vesting", label: "Vesting" },
    { key: "MultiAsset", label: "Multi-Asset" },
    { key: "MultiSig", label: "Multi-Sig" },
    { key: "MultiAssetVesting", label: "Multi-Asset Vesting" },
    { key: "DeadManSwitch", label: "Dead Man's Switch" },
    { key: "HTLC", label: "HTLC" },
  ],
};

/** Map advanced-vault kind / source to a TierVaultType. */
export function toTierVaultType(
  source: "standard" | "multi" | "advanced",
  advancedKind?: string | null,
): TierVaultType {
  if (source === "standard") return "TimeLock";
  if (source === "multi") return "MultiAsset";
  if (!advancedKind || typeof advancedKind !== "string") return "TimeLock";
  // Tolerate alternate spellings from RPC decode / legacy mirrors.
  const compact = advancedKind.replace(/[_\s-]/g, "").toLowerCase();
  if (compact === "coolingoff") return "CoolingOff";
  if (compact === "vesting" || compact === "vestingschedule") return "Vesting";
  if (compact === "multiassetvesting") return "MultiAssetVesting";
  if (compact === "deadmanswitch" || compact === "dms") return "DeadManSwitch";
  if (compact === "multisig" || compact === "dualapproval") return "MultiSig";
  if (compact === "htlc") return "HTLC";
  if (compact === "timelock") return "TimeLock";
  return "TimeLock";
}

export function isTierHydrated(): boolean {
  return hydrated;
}