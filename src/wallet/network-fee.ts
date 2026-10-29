// Network Fee Estimator.
//
// Polls Horizon's `/fee_stats` endpoint to track the current Stellar
// mainnet base fee + congestion. Surfaced via:
//   - `<NetworkFeeBadge>`   (dashboard header + Send form chrome)
//   - `recommendedMaxFee()` (Tx builder maxFee binding)
//
// Why we need this:
//   * Stellar's `BASE_FEE` (100 stroops) is fine 99% of the time, but
//     during DEX flash-events or contract storms `ledger_capacity_usage`
//     spikes and a 100-stroop tx can sit in the queue for several
//     ledgers — or get evicted. Bumping the `maxFee` to the running
//     90th percentile keeps user txs included in the next 1-2 ledgers
//     even under load.
//   * `maxFee` is an UPPER BOUND. The validator only charges the
//     `min(bid_fee, lower_bid_in_block)` — paying a higher max never
//     overpays; it just guarantees inclusion.

import { getActiveDeployment } from "@/src/wallet/contract-config";

/** Stellar's protocol-level absolute floor — 100 stroops = 0.00001 XLM. */
export const BASE_FEE_STROOPS = 100;

export type Congestion = "low" | "medium" | "high" | "unknown";

export interface FeeStatsSnapshot {
  baseFee: number;       // current network base fee in stroops
  p50: number;           // median accepted fee
  p70: number;
  p90: number;
  p99: number;
  ledgerCapacityUsage: number; // 0..1
  congestion: Congestion;
  fetchedAt: number;     // ms epoch
}

let _last: FeeStatsSnapshot | null = null;
let _inFlight: Promise<FeeStatsSnapshot | null> | null = null;

export function getLastSnapshot(): FeeStatsSnapshot | null {
  return _last;
}

function toCongestion(usage: number): Congestion {
  if (!Number.isFinite(usage)) return "unknown";
  if (usage < 0.5) return "low";
  if (usage < 0.8) return "medium";
  return "high";
}

export async function fetchFeeStats(): Promise<FeeStatsSnapshot | null> {
  if (_inFlight) return _inFlight;
  const horizon = getActiveDeployment().horizonUrl.replace(/\/+$/, "");
  _inFlight = (async () => {
    try {
      const res = await fetch(`${horizon}/fee_stats`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return _last; // keep previous on transient error
      const json = await res.json();
      const baseFee = parseInt(String(json.last_ledger_base_fee ?? json.min_accepted_fee ?? BASE_FEE_STROOPS), 10);
      const usage = parseFloat(String(json.ledger_capacity_usage ?? "0"));
      // Horizon returns two histogram blocks: `fee_charged` (what users
      // actually paid) and `max_fee` (what they bid). We use `max_fee.p…`
      // because that's the bid that wins inclusion under load.
      const m = json.max_fee ?? {};
      const snap: FeeStatsSnapshot = {
        baseFee: Number.isFinite(baseFee) ? baseFee : BASE_FEE_STROOPS,
        p50: parseInt(String(m.p50 ?? baseFee), 10) || baseFee,
        p70: parseInt(String(m.p70 ?? baseFee), 10) || baseFee,
        p90: parseInt(String(m.p90 ?? baseFee), 10) || baseFee,
        p99: parseInt(String(m.p99 ?? baseFee), 10) || baseFee,
        ledgerCapacityUsage: Number.isFinite(usage) ? usage : 0,
        congestion: toCongestion(usage),
        fetchedAt: Date.now(),
      };
      _last = snap;
      return snap;
    } catch {
      return _last;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

/**
 * Recommended `maxFee` for a transaction builder. We bid the larger of:
 *   - 1000 stroops (10× protocol minimum — cheap, included under normal load)
 *   - the live `max_fee.p90` from Horizon (keeps txs included under load)
 *
 * The validator only charges the lower bid in the block; this is an
 * upper bound for inclusion, NOT what the user actually pays.
 */
export function recommendedMaxFeeStroops(snap: FeeStatsSnapshot | null = _last): string {
  const floor = 1000;
  if (!snap) return String(floor);
  const bid = Math.max(floor, snap.p90 || floor, snap.baseFee || floor);
  // Cap at a sane 100_000 stroops (0.01 XLM) so a Horizon misread can
  // never blow out a user's wallet on fees. Real-world Stellar p99 has
  // never crossed 1000 stroops outside of synthetic stress tests.
  return String(Math.min(bid, 100_000));
}
