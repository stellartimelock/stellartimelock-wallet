// @CONTEXT: shared vault-list loader for UnifiedVaultsList / ActiveVaultsSection /
// TierMonitorDashboard. Session-cached; skips network on focus when fresh;
// background-refreshes when stale; hard-refreshes on wallet switch + pull-to-refresh.
//
// Tier-gated: all tiers fetch standard Time-Lock + Advanced (so Free beneficiaries
// can discover Dead Man's Switch vaults). Pro/Elite also fetch beta multi-asset +
// Multi-Sig. The tier used for a fetch is stored on the snapshot (`fetchedForTier`)
// so a tier upgrade triggers a background refresh that pulls newly-accessible types.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { api, type Vault } from "@/src/api/client";
import { useSession } from "@/src/state/session";
import {
  getCurrentTier,
  hydrateTier,
  isTierHydrated,
  type TierId,
} from "@/src/tiers/tier-config";
import { listMultiSigEntries } from "@/src/vault/multi-sig-store";
import {
  getVaultSessionSnapshot,
  hydrateVaultSessionCache,
  invalidateVaultSessionCache,
  isVaultSessionStale,
  requestVaultListRefresh,
  setVaultSessionSnapshot,
  subscribeVaultListRefresh,
  subscribeVaultSessionCache,
  type MultiSigSessionRow,
  type VaultSessionSnapshot,
  VAULT_SESSION_STALE_MS,
} from "@/src/vault/vault-session-cache";
import {
  getMultiSigVault,
  getMultiSigWithdrawalRequest,
  listAdvancedVaults,
  stroopsToFloat,
  type AdvancedVaultRecord,
} from "@/src/wallet/advanced-vaults";
import {
  listBetaVaults,
  type BetaVaultRecord,
} from "@/src/wallet/multi-asset-beta";

async function loadMultiSigRows(
  walletPublicKey: string,
): Promise<MultiSigSessionRow[]> {
  const entries = await listMultiSigEntries(walletPublicKey);
  const rows: MultiSigSessionRow[] = [];
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const [vault, req] = await Promise.all([
          getMultiSigVault(walletPublicKey, entry.contractId),
          getMultiSigWithdrawalRequest(walletPublicKey, entry.contractId),
        ]);
        const balance = BigInt(String(vault?.balance ?? vault?.amount ?? "0"));
        let pendingApproval = false;
        if (req && typeof req === "object") {
          const approved = Boolean(
            req.approved ?? req.is_approved ?? req.co_signer_approved ?? false,
          );
          const amount = BigInt(String(req.amount ?? "0"));
          pendingApproval = amount > 0n && !approved;
        }
        rows.push({
          entry,
          balanceXlm: stroopsToFloat(balance),
          pendingApproval,
          unlockTimestamp: Number(
            vault?.unlock_timestamp ?? vault?.unlockTimestamp ?? 0,
          ),
        });
      } catch {
        rows.push({
          entry,
          balanceXlm: 0,
          pendingApproval: false,
          unlockTimestamp: 0,
        });
      }
    }),
  );
  return rows;
}

/** Which vault families does a tier need on-chain reads for? */
function wantsAdvanced(_tier: TierId): boolean {
  // All tiers load advanced vaults so Free beneficiaries can discover
  // Dead Man's Switch vaults via memo scan (listAdvancedVaults merges them).
  return true;
}
function wantsBeta(tier: TierId): boolean {
  return tier === "pro" || tier === "elite";
}
function wantsMultiSig(tier: TierId): boolean {
  return tier === "pro" || tier === "elite";
}

/**
 * A fetch made for a higher tier always covers lower tiers' needs (it pulls a
 * superset). A snapshot is "covering" for `tier` when its fetch tier is at
 * least as rich. Rank: free=0, plus=1, pro/elite=2.
 */
function snapshotCoversTier(snap: VaultSessionSnapshot, tier: TierId): boolean {
  const rank = (t: TierId) => (t === "pro" || t === "elite" ? 2 : t === "plus" ? 1 : 0);
  return rank(snap.fetchedForTier ?? "free") >= rank(tier);
}

/** Ensure the tier cache is hydrated, then resolve the current tier (with per-wallet Elite override). */
async function resolveTierForOwner(owner: string): Promise<TierId> {
  if (!isTierHydrated()) {
    await hydrateTier(owner);
  }
  return getCurrentTier(owner);
}

async function fetchAll(
  owner: string,
  tier: TierId,
): Promise<Omit<VaultSessionSnapshot, "fetchedAt">> {
  const [standard, beta, advanced, multiSig] = await Promise.all([
    api.listVaults(owner, owner).catch(() => [] as Vault[]),
    wantsBeta(tier)
      ? listBetaVaults(owner).catch(() => [] as BetaVaultRecord[])
      : Promise.resolve([] as BetaVaultRecord[]),
    wantsAdvanced(tier)
      ? listAdvancedVaults(owner, owner).catch(() => [] as AdvancedVaultRecord[])
      : Promise.resolve([] as AdvancedVaultRecord[]),
    wantsMultiSig(tier)
      ? loadMultiSigRows(owner).catch(() => [] as MultiSigSessionRow[])
      : Promise.resolve([] as MultiSigSessionRow[]),
  ]);
  return { owner, fetchedForTier: tier, standard, beta, advanced, multiSig };
}

/** Module-level in-flight dedupe across every mounted consumer. */
let sharedFetch: Promise<VaultSessionSnapshot | null> | null = null;
let sharedFetchOwner: string | null = null;
let sharedFetchTier: TierId | null = null;

function fetchShared(
  owner: string,
  tier: TierId,
): Promise<VaultSessionSnapshot | null> {
  if (sharedFetch && sharedFetchOwner === owner && sharedFetchTier === tier) {
    return sharedFetch;
  }
  sharedFetchOwner = owner;
  sharedFetchTier = tier;
  sharedFetch = (async () => {
    try {
      const data = await fetchAll(owner, tier);
      return setVaultSessionSnapshot(data);
    } catch {
      return getVaultSessionSnapshot(owner);
    } finally {
      sharedFetch = null;
      sharedFetchOwner = null;
      sharedFetchTier = null;
    }
  })();
  return sharedFetch;
}

export interface UseVaultSessionDataResult {
  standard: Vault[] | null;
  beta: BetaVaultRecord[];
  advanced: AdvancedVaultRecord[];
  multiSig: MultiSigSessionRow[];
  loading: boolean;
  /** True while a refresh is in flight over already-visible rows. */
  refreshing: boolean;
  error: string | null;
  /** Force network refresh (manual). Prefer requestVaultListRefresh from parents. */
  refresh: () => Promise<void>;
}

export function useVaultSessionData(): UseVaultSessionDataResult {
  const { wallet } = useSession();
  const owner = wallet?.publicKey ?? null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  const cached = getVaultSessionSnapshot(owner);
  const [standard, setStandard] = useState<Vault[] | null>(
    cached?.standard ?? null,
  );
  const [beta, setBeta] = useState<BetaVaultRecord[]>(cached?.beta ?? []);
  const [advanced, setAdvanced] = useState<AdvancedVaultRecord[]>(
    cached?.advanced ?? [],
  );
  const [multiSig, setMultiSig] = useState<MultiSigSessionRow[]>(
    cached?.multiSig ?? [],
  );
  const [loading, setLoading] = useState(!cached && !!owner);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((snap: VaultSessionSnapshot) => {
    setStandard(snap.standard);
    setBeta(snap.beta);
    setAdvanced(snap.advanced);
    setMultiSig(snap.multiSig);
    setError(null);
  }, []);

  const runFetch = useCallback(
    async (opts: { force: boolean }) => {
      const currentOwner = ownerRef.current;
      if (!currentOwner) {
        setStandard([]);
        setBeta([]);
        setAdvanced([]);
        setMultiSig([]);
        setLoading(false);
        setRefreshing(false);
        setError(null);
        return;
      }

      // Warm from AsyncStorage on cold start so RAM cache + state settle fast.
      await hydrateVaultSessionCache(currentOwner);
      const currentTier = await resolveTierForOwner(currentOwner);

      const existing = getVaultSessionSnapshot(currentOwner);
      if (
        !opts.force &&
        existing &&
        !isVaultSessionStale(currentOwner) &&
        snapshotCoversTier(existing, currentTier)
      ) {
        applySnapshot(existing);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (existing) {
        applySnapshot(existing);
        setLoading(false);
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const snap = await fetchShared(currentOwner, currentTier);
        if (ownerRef.current !== currentOwner) return;
        if (snap) {
          applySnapshot(snap);
        } else if (!getVaultSessionSnapshot(currentOwner)) {
          setError("Could not load vaults.");
          setStandard([]);
          setBeta([]);
          setAdvanced([]);
          setMultiSig([]);
        }
      } catch (e) {
        if (ownerRef.current !== currentOwner) return;
        console.warn("[VaultSession] refresh failed:", e);
        setError("Couldn't load vaults. Pull down to retry.");
        if (!getVaultSessionSnapshot(currentOwner)) {
          setStandard([]);
          setBeta([]);
          setAdvanced([]);
          setMultiSig([]);
        }
      } finally {
        if (ownerRef.current === currentOwner) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [applySnapshot],
  );

  // Wallet switch: show that owner's cache immediately (RAM or AsyncStorage),
  // else clear + fetch. Tier upgrades also trigger a richer refetch.
  useEffect(() => {
    if (!owner) {
      setStandard([]);
      setBeta([]);
      setAdvanced([]);
      setMultiSig([]);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      await hydrateVaultSessionCache(owner);
      if (cancelled) return;
      const snap = getVaultSessionSnapshot(owner);
      if (snap) {
        applySnapshot(snap);
        setLoading(false);
        // Refetch when stale OR when the cached snapshot doesn't cover the
        // current tier (e.g. fetched as Free, tier now Pro).
        void resolveTierForOwner(owner).then((tier) => {
          if (cancelled) return;
          if (isVaultSessionStale(owner) || !snapshotCoversTier(snap, tier)) {
            void runFetch({ force: true });
          }
        });
        return;
      }
      // No cache for this wallet — never flash the previous wallet's vaults.
      setStandard(null);
      setBeta([]);
      setAdvanced([]);
      setMultiSig([]);
      setError(null);
      setLoading(true);
      void runFetch({ force: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [owner, applySnapshot, runFetch]);

  // Focus: keep cached rows; background-refresh only when stale.
  useFocusEffect(
    useCallback(() => {
      if (!owner) return;
      void (async () => {
        await hydrateVaultSessionCache(owner);
        const snap = getVaultSessionSnapshot(owner);
        if (!snap) {
          void runFetch({ force: true });
          return;
        }
        applySnapshot(snap);
        const tier = await resolveTierForOwner(owner);
        if (isVaultSessionStale(owner) || !snapshotCoversTier(snap, tier)) {
          void runFetch({ force: true });
        }
      })();
    }, [owner, applySnapshot, runFetch]),
  );

  // Pull-to-refresh bus (wallet screen, etc.).
  useEffect(() => {
    return subscribeVaultListRefresh(() => {
      void runFetch({ force: true });
    });
  }, [runFetch]);

  // Keep local state in sync when another consumer writes the session cache.
  useEffect(() => {
    return subscribeVaultSessionCache(() => {
      const currentOwner = ownerRef.current;
      if (!currentOwner) return;
      const snap = getVaultSessionSnapshot(currentOwner);
      if (snap) applySnapshot(snap);
    });
  }, [applySnapshot]);

  const refresh = useCallback(async () => {
    requestVaultListRefresh();
  }, []);

  return {
    standard,
    beta,
    advanced,
    multiSig,
    loading,
    refreshing,
    error,
    refresh,
  };
}

export {
  VAULT_SESSION_STALE_MS,
  requestVaultListRefresh,
  invalidateVaultSessionCache,
  hydrateVaultSessionCache,
};
export type { MultiSigSessionRow, VaultSessionSnapshot };