// Soroban RPC failover.
//
// Mobile carriers treat Soroban RPC providers asymmetrically — an endpoint
// that works from server egress may fail on residential/mobile connections.
// Each network ships a primary `rpcUrl` plus ordered `rpcFallbacks`; this
// module rotates in-memory on transport errors via `rotateRpcUrl()`.
// Selection is not persisted so every cold boot retries the canonical primary.

import {
  getActiveDeployment,
  type StellarNetwork,
} from "@/src/wallet/contract-config";
import { getRpcOverrideSync, isHttpsRpcUrl } from "@/src/wallet/advanced-settings-prefs";

interface FailoverState {
  /** Index into `[rpcUrl, ...rpcFallbacks]` for the active candidate. */
  index: number;
  /** Last error message, surfaced in diagnostics. */
  lastError?: string;
}

const _state: Record<StellarNetwork, FailoverState> = {
  testnet: { index: 0 },
  mainnet: { index: 0 },
};

function candidatesFor(network: StellarNetwork): string[] {
  // Resolve once per call — `getActiveDeployment` may switch under us
  // when the user changes networks via Settings.
  const dep = getActiveDeployment();
  if (dep.network !== network) {
    // Should not happen in practice — `getActiveDeployment().network`
    // is the source of truth. Defensive fallback for non-active reads.
    const all = [dep.rpcUrl, ...(dep.rpcFallbacks ?? [])];
    return all;
  }
  return [dep.rpcUrl, ...(dep.rpcFallbacks ?? [])];
}

/**
 * Current preferred Soroban RPC URL for the active network. Use this
 * everywhere instead of `getActiveDeployment().rpcUrl` so the failover
 * rotation is honored. A user-set override (Advanced Settings /
 * Diagnostics) wins over failover rotation.
 */
export function getCurrentRpcUrl(): string {
  const override = getRpcOverrideSync();
  if (override && isHttpsRpcUrl(override)) return override;
  const dep = getActiveDeployment();
  const candidates = candidatesFor(dep.network);
  const state = _state[dep.network];
  const idx = Math.min(state.index, candidates.length - 1);
  return candidates[idx];
}

/**
 * Mark the current URL as unhealthy and rotate to the next candidate
 * (wrapping back to 0 once we've exhausted them). Idempotent — calling
 * twice in succession only rotates once if the URL hasn't changed in
 * between.
 *
 * Returns the URL we just rotated AWAY FROM (useful for log lines that
 * want to say "RPC X failed, now trying Y").
 */
export function rotateRpcUrl(reason?: unknown): string {
  const dep = getActiveDeployment();
  const candidates = candidatesFor(dep.network);
  if (candidates.length <= 1) {
    // Nothing to rotate to — just record the error and stay put.
    _state[dep.network].lastError =
      reason instanceof Error ? reason.message : String(reason ?? "");
    return candidates[0];
  }
  const prevIdx = Math.min(_state[dep.network].index, candidates.length - 1);
  _state[dep.network].index = (prevIdx + 1) % candidates.length;
  _state[dep.network].lastError =
    reason instanceof Error ? reason.message : String(reason ?? "");
  return candidates[prevIdx];
}

/**
 * Heuristic: is `err` a *transport-level* failure where rotating to a
 * different RPC could plausibly help? We deliberately do NOT rotate on
 * Soroban-level errors (simulation failure, invalid xdr, etc.) — those
 * are deterministic across providers.
 *
 * NOTE: we used to include "invalid checksum" here on the assumption that
 * it meant a truncated upstream response. In practice that error string
 * comes from a LOCAL XDR-decode failure inside `@stellar/stellar-sdk`
 * (Hermes's TextEncoder/Buffer differences during `scValToNative` of an
 * SCAddress / strkey checksum byte), which is deterministic across
 * providers — rotating just moves the failure to a different RPC without
 * fixing anything, masking the real symptom and burning the fallback
 * budget. The Hermes-simulate fallback in `soroban-client.ts:listVaults`
 * now handles that case by rebuilding the vault list from events instead.
 */
export function isRpcTransportError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const lc = msg.toLowerCase();
  // Common shapes: fetch network error, DNS, TLS handshake, HTTP 5xx,
  // 429 rate-limit, JSON parse errors when the upstream returns an HTML
  // error page, "invalid checksum" (reported by some mobile carriers
  // when the connection is silently truncated).
  return (
    lc.includes("network") ||
    lc.includes("timed out") ||
    lc.includes("timeout") ||
    lc.includes("fetch") ||
    lc.includes("getaddrinfo") ||
    lc.includes("econnreset") ||
    lc.includes("enotfound") ||
    lc.includes("cors") ||
    /\bhttp\s*(5\d\d|429|408|502|503|504)\b/.test(lc) ||
    /unexpected\s+token/.test(lc) // body was HTML, not JSON
  );
}

/**
 * Wrap a function that builds & uses a server-bound resource. If the
 * inner call throws a transport-level error, rotate and retry until the
 * candidate list is exhausted, then re-throw the last error.
 *
 * `factory` is invoked on every attempt so it can capture the freshly
 * rotated URL via `getCurrentRpcUrl()`.
 */
export async function runWithRpcFailover<T>(factory: () => Promise<T>): Promise<T> {
  const dep = getActiveDeployment();
  const total = candidatesFor(dep.network).length;
  let lastErr: unknown;
  for (let attempt = 0; attempt < Math.max(1, total); attempt++) {
    try {
      return await factory();
    } catch (e) {
      lastErr = e;
      if (!isRpcTransportError(e) || attempt === total - 1) {
        throw e;
      }
      rotateRpcUrl(e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Debug snapshot — exposed for the Diagnostics screen.
 */
export function rpcFailoverState(): {
  network: StellarNetwork;
  current: string;
  candidates: string[];
  lastError?: string;
} {
  const dep = getActiveDeployment();
  return {
    network: dep.network,
    current: getCurrentRpcUrl(),
    candidates: candidatesFor(dep.network),
    lastError: _state[dep.network].lastError,
  };
}
