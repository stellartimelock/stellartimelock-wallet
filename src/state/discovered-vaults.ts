/**
 * Lightweight pub/sub + hook for memo-discovered multi-party vaults.
 * Kept outside SessionProvider so stellar-sdk stays out of the cold-start path.
 */

import { useCallback, useEffect, useState } from "react";

import {
  countNewDiscovered,
  discoverVaultsFromMemos,
  getCachedDiscoveredVaults,
  markDiscoveredVaultSeen,
  subscribeDiscoveredVaults,
  type DiscoveredVaultRecord,
} from "@/src/vault/memo-discovery";

export function useDiscoveredVaults(walletPublicKey: string | null | undefined) {
  const [vaults, setVaults] = useState<DiscoveredVaultRecord[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<number | null>(null);

  const reloadCache = useCallback(async () => {
    if (!walletPublicKey) {
      setVaults([]);
      return;
    }
    const cached = await getCachedDiscoveredVaults(walletPublicKey);
    setVaults(cached);
  }, [walletPublicKey]);

  const scan = useCallback(async () => {
    if (!walletPublicKey) return [];
    setScanning(true);
    try {
      const next = await discoverVaultsFromMemos(walletPublicKey);
      setVaults(next);
      setLastScannedAt(Date.now());
      return next;
    } finally {
      setScanning(false);
    }
  }, [walletPublicKey]);

  const markSeen = useCallback(
    async (key: string) => {
      if (!walletPublicKey) return;
      await markDiscoveredVaultSeen(walletPublicKey, key);
      await reloadCache();
    },
    [walletPublicKey, reloadCache],
  );

  useEffect(() => {
    // Drop previous wallet's discovered rows immediately on switch.
    setVaults([]);
    void reloadCache();
    return subscribeDiscoveredVaults(() => {
      void reloadCache();
    });
  }, [reloadCache]);

  // Auto-scan once when the wallet becomes available.
  useEffect(() => {
    if (!walletPublicKey) return;
    void scan();
  }, [walletPublicKey]); // eslint-disable-line react-hooks/exhaustive-deps -- scan on wallet change only

  return {
    vaults,
    scanning,
    lastScannedAt,
    newCount: countNewDiscovered(vaults),
    scan,
    markSeen,
    reloadCache,
  };
}
