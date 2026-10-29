// @CONTEXT: in-memory session cache for vault list screens so tab focus /
// remount doesn't re-hit Soroban RPC every time. Fresh reads still happen on
// pull-to-refresh, explicit refresh, or when the snapshot is older than
// STALE_MS (background refresh while cached rows stay visible). Multi-slot
// (up to MAX_CACHED_WALLETS owners) so switching back to a recently-used
// wallet returns its cached rows immediately instead of a cold Soroban reload.
//
// Snapshots are also mirrored to AsyncStorage (per-owner key) so a cold app
// start can show the previous session's rows instantly. The RAM copy remains
// the source of truth while the app is alive. BigInt fields
// (AdvancedVaultRecord.vaultId / balance / totalLockedAmount / withdrawnSoFar,
// BetaVaultRecord.vaultId / balance) are stringified on disk because
// JSON.stringify throws on BigInt.

import type { Vault } from "@/src/api/client";
import type { AdvancedVaultRecord } from "@/src/wallet/advanced-vaults";
import type { BetaVaultRecord } from "@/src/wallet/multi-asset-beta";
import type { MultiSigEntry } from "@/src/vault/multi-sig-store";
import type { TierId } from "@/src/tiers/tier-config";

import { storage } from "@/src/utils/storage";

/** Cached rows are stale after 60s — show them immediately, refresh in background. */
export const VAULT_SESSION_STALE_MS = 60_000;

/** Keep at most this many recent owners in the in-memory session cache. */
const MAX_CACHED_WALLETS = 3;

const CACHE_STORAGE_PREFIX = "vault_session_cache_v1_";

export interface MultiSigSessionRow {
  entry: MultiSigEntry;
  balanceXlm: number;
  pendingApproval: boolean;
  unlockTimestamp: number;
}

export interface VaultSessionSnapshot {
  owner: string;
  fetchedAt: number;
  /** Tier the snapshot was fetched with — lets us refetch after a tier upgrade. */
  fetchedForTier?: TierId;
  standard: Vault[];
  beta: BetaVaultRecord[];
  advanced: AdvancedVaultRecord[];
  multiSig: MultiSigSessionRow[];
}

/** JSON-safe mirror of VaultSessionSnapshot (BigInts → strings). */
interface PersistedVaultSnapshot {
  owner: string;
  fetchedAt: number;
  fetchedForTier?: TierId;
  standard: Vault[];
  beta: Array<
    Omit<BetaVaultRecord, "vaultId" | "balance"> & {
      vaultId: string;
      balance: string;
    }
  >;
  advanced: Array<
    Omit<
      AdvancedVaultRecord,
      "vaultId" | "balance" | "totalLockedAmount" | "withdrawnSoFar"
    > & {
      vaultId: string;
      balance: string;
      totalLockedAmount: string;
      withdrawnSoFar: string;
    }
  >;
  multiSig: MultiSigSessionRow[];
}

type Listener = () => void;

/** Per-owner snapshots, LRU-ordered (oldest insertion first → evicted first). */
const snapshots = new Map<string, VaultSessionSnapshot>();
const listeners = new Set<Listener>();
/** Owners we've mirrored to AsyncStorage this session (for cleanup). */
const persistedOwnerKeys = new Set<string>();

function cacheStorageKey(owner: string): string {
  return `${CACHE_STORAGE_PREFIX}${owner}`;
}

function serializeSnapshot(snap: VaultSessionSnapshot): PersistedVaultSnapshot {
  return {
    owner: snap.owner,
    fetchedAt: snap.fetchedAt,
    fetchedForTier: snap.fetchedForTier,
    standard: snap.standard,
    beta: snap.beta.map((b) => ({
      ...b,
      vaultId: b.vaultId.toString(),
      balance: b.balance.toString(),
    })),
    advanced: snap.advanced.map((a) => ({
      ...a,
      vaultId: a.vaultId.toString(),
      balance: a.balance.toString(),
      totalLockedAmount: a.totalLockedAmount.toString(),
      withdrawnSoFar: a.withdrawnSoFar.toString(),
    })),
    multiSig: snap.multiSig,
  };
}

function deserializeSnapshot(raw: PersistedVaultSnapshot): VaultSessionSnapshot {
  return {
    owner: raw.owner,
    fetchedAt: raw.fetchedAt,
    fetchedForTier: raw.fetchedForTier,
    standard: raw.standard ?? [],
    beta: (raw.beta ?? []).map((b) => ({
      ...b,
      vaultId: BigInt(b.vaultId || "0"),
      balance: BigInt(b.balance || "0"),
    })),
    advanced: (raw.advanced ?? []).map((a) => ({
      ...a,
      vaultId: BigInt(a.vaultId || "0"),
      balance: BigInt(a.balance || "0"),
      totalLockedAmount: BigInt(a.totalLockedAmount || "0"),
      withdrawnSoFar: BigInt(a.withdrawnSoFar || "0"),
    })),
    multiSig: raw.multiSig ?? [],
  };
}

/** Fire-and-forget mirror of the snapshot to AsyncStorage for cold starts. */
function persistSnapshot(snap: VaultSessionSnapshot): void {
  if (!snap.owner) return;
  persistedOwnerKeys.add(snap.owner);
  try {
    void storage.setItem<PersistedVaultSnapshot>(
      cacheStorageKey(snap.owner),
      serializeSnapshot(snap),
    );
  } catch {
    /* best-effort — RAM cache is the source of truth while alive */
  }
}

/**
 * Seed the in-memory snapshot for `owner` from AsyncStorage when the RAM
 * cache is empty (cold start / app restart). No-op when the RAM cache
 * already has an entry — the RAM copy is always fresher than disk.
 */
export async function hydrateVaultSessionCache(
  owner: string | null | undefined,
): Promise<void> {
  if (!owner || snapshots.has(owner)) return;
  try {
    const raw = await storage.getItem<PersistedVaultSnapshot>(
      cacheStorageKey(owner),
      {
        owner: "",
        fetchedAt: 0,
        standard: [],
        beta: [],
        advanced: [],
        multiSig: [],
      },
    );
    if (!raw || typeof raw !== "object" || !raw.owner) return;
    snapshots.set(raw.owner, deserializeSnapshot(raw));
    // No listener notification — the caller applies the snapshot directly.
  } catch {
    /* best-effort — fall through to a full network fetch */
  }
}

export function getVaultSessionSnapshot(
  owner: string | null | undefined,
): VaultSessionSnapshot | null {
  if (!owner) return null;
  return snapshots.get(owner) ?? null;
}

export function isVaultSessionStale(
  owner: string | null | undefined,
  staleMs: number = VAULT_SESSION_STALE_MS,
): boolean {
  const snap = getVaultSessionSnapshot(owner);
  if (!snap) return true;
  return Date.now() - snap.fetchedAt > staleMs;
}

export function setVaultSessionSnapshot(
  next: Omit<VaultSessionSnapshot, "fetchedAt"> & { fetchedAt?: number },
): VaultSessionSnapshot {
  const snap: VaultSessionSnapshot = {
    ...next,
    fetchedAt: next.fetchedAt ?? Date.now(),
  };
  if (!snap.owner) return snap;
  // Re-insert so this owner moves to the most-recently-used (end) position.
  if (snapshots.has(snap.owner)) snapshots.delete(snap.owner);
  snapshots.set(snap.owner, snap);
  // Evict the least-recently-used owner when we exceed the cap.
  while (snapshots.size > MAX_CACHED_WALLETS) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined || oldest === snap.owner) break;
    snapshots.delete(oldest);
  }
  persistSnapshot(snap);
  for (const l of listeners) l();
  return snap;
}

/** Drop cache (all owners, or only when it matches `owner`). */
export function invalidateVaultSessionCache(owner?: string | null): void {
  let changed = false;
  if (owner) {
    changed = snapshots.delete(owner);
    persistedOwnerKeys.delete(owner);
    void storage.removeItem(cacheStorageKey(owner));
  } else {
    changed = snapshots.size > 0;
    snapshots.clear();
    for (const key of persistedOwnerKeys) {
      void storage.removeItem(cacheStorageKey(key));
    }
    persistedOwnerKeys.clear();
  }
  if (changed) for (const l of listeners) l();
}

/** Mark the matching snapshot(s) stale so subscribers background-refresh, keeping rows. */
export function markVaultSessionCacheStale(owner?: string | null): void {
  let changed = false;
  if (owner) {
    const snap = snapshots.get(owner);
    if (!snap) return;
    snapshots.set(owner, { ...snap, fetchedAt: 0 });
    changed = true;
  } else {
    if (snapshots.size === 0) return;
    for (const [k, v] of snapshots) snapshots.set(k, { ...v, fetchedAt: 0 });
    changed = true;
  }
  if (changed) for (const l of listeners) l();
}

export function subscribeVaultSessionCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Bump for pull-to-refresh / manual refresh — forces subscribers to refetch. */
let refreshEpoch = 0;
const refreshListeners = new Set<Listener>();

export function getVaultRefreshEpoch(): number {
  return refreshEpoch;
}

export function requestVaultListRefresh(): number {
  refreshEpoch += 1;
  markVaultSessionCacheStale();
  for (const l of refreshListeners) l();
  return refreshEpoch;
}

export function subscribeVaultListRefresh(listener: Listener): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}