import { useEffect, useState } from "react";

import {
  fetchFeeStats,
  getLastSnapshot,
  type FeeStatsSnapshot,
} from "@/src/wallet/network-fee";
import { POLL_MIN_INTERVAL_MS, clampPollInterval } from "@/src/utils/polling";

export function useNetworkFee(
  intervalMs: number = POLL_MIN_INTERVAL_MS,
): FeeStatsSnapshot | null {
  const [snap, setSnap] = useState<FeeStatsSnapshot | null>(() => getLastSnapshot());

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      const next = await fetchFeeStats();
      if (mounted) setSnap(next);
    };
    tick(); // immediate — one fetch on mount so the badge isn't blank
    const id = setInterval(tick, clampPollInterval(intervalMs));
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [intervalMs]);

  return snap;
}
