// Real Soroban RPC reader for the deployed XlmVault contract.
//
// This module only handles READ paths. Reads go through Soroban's RPC
// `simulateTransaction` endpoint, which executes a contract call in a
// throwaway VM and returns the result — no signing, no fees, no ledger
// state change. That is sufficient for `get_vault`, `list_owned`, and any
// derived aggregations.
//
// WRITE paths (create / deposit / extend / withdraw) live in
// `src/api/soroban-client.ts` and use the runtime network selector via
// `getActiveDeployment()`. This file follows the same pattern — every RPC
// call resolves the active network at call time.
//
// Spec references:
//   - Soroban RPC:        https://developers.stellar.org/network/soroban-rpc/api-reference
//   - simulateTransaction https://developers.stellar.org/network/soroban-rpc/api-reference/methods/simulateTransaction
//   - getLedgerEntries:   https://developers.stellar.org/network/soroban-rpc/api-reference/methods/getLedgerEntries

import {
  getActiveDeployment,
  type StellarNetwork,
} from "@/src/wallet/contract-config";
import {
  getCurrentRpcUrl,
  isRpcTransportError,
  rotateRpcUrl,
} from "@/src/wallet/rpc-failover";

type Json = unknown;

interface RpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

let nextId = 1;

async function rpc<T>(method: string, params: Json): Promise<T> {
  // Failover loop: try the currently-selected URL, and if it fails with
  // a transport-level error, rotate and try the next candidate. We do
  // NOT rotate on JSON-RPC level errors (e.g. method not found) — those
  // are deterministic across providers.
  const dep = getActiveDeployment();
  const totalCandidates = 1 + (dep.rpcFallbacks?.length ?? 0);
  let lastErr: unknown;
  for (let attempt = 0; attempt < Math.max(1, totalCandidates); attempt++) {
    const url = getCurrentRpcUrl();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      });
      if (!res.ok) {
        // 5xx / 429 / 404 all warrant a rotation attempt.
        const transportErr = new Error(`Soroban RPC ${method}: HTTP ${res.status}`);
        if (isRpcTransportError(transportErr) && attempt < totalCandidates - 1) {
          rotateRpcUrl(transportErr);
          lastErr = transportErr;
          continue;
        }
        throw transportErr;
      }
      const body = (await res.json()) as RpcResponse<T>;
      if (body.error) {
        // JSON-RPC payload error — don't rotate, surface to caller.
        throw new Error(`Soroban RPC ${method}: ${body.error.message}`);
      }
      if (body.result === undefined) {
        throw new Error(`Soroban RPC ${method}: empty result`);
      }
      return body.result;
    } catch (e) {
      lastErr = e;
      if (!isRpcTransportError(e) || attempt === totalCandidates - 1) {
        throw e;
      }
      rotateRpcUrl(e);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

interface HealthResult {
  status: "healthy" | "unhealthy";
  latestLedger: number;
  oldestLedger: number;
  ledgerRetentionWindow: number;
}

/**
 * Basic liveness check for the configured RPC endpoint.
 * Used by the Settings panel "Connected" badge.
 */
export async function getNetworkHealth(): Promise<HealthResult> {
  return rpc<HealthResult>("getHealth", {});
}

interface ContractDataResult {
  latestLedger: number;
  entries: {
    key: string;
    xdr: string;
    lastModifiedLedgerSeq: number;
  }[];
}

// Pre-computed LedgerKey XDR per network contract id (avoids bundling full XDR encoder).
// Regenerate on new deployment via `stellar xdr encode --type LedgerKey '{...}'`.

const CONTRACT_INSTANCE_LEDGER_KEY: Record<StellarNetwork, string | null> = {
  testnet: "AAAABgAAAAFReKxdNDzu0oktYotkf/v6ulUm3cxqVlwljgT5d4ZaowAAABQAAAAB",
  mainnet: "AAAABgAAAAGsNiHj5mc0V6uPdvHvXWS9WJi7skiYqaJClbN8/gXTugAAABQAAAAB",
};

/**
 * Read the contract instance metadata from the ledger. We use this purely as
 * proof-of-life — a successful response with non-empty entries confirms the
 * contract id is live on-chain and the RPC endpoint can reach it.
 *
 * If the active network does not yet have a pre-computed ledger key (the
 * mainnet case before the contract is deployed), this falls back to the
 * RPC's `getHealth` so the Settings card still shows a green dot when the
 * network is reachable.
 */
export async function checkContractAlive(): Promise<boolean> {
  const dep = getActiveDeployment();
  const key = CONTRACT_INSTANCE_LEDGER_KEY[dep.network];
  try {
    if (!key) {
      const h = await getNetworkHealth();
      return h.status === "healthy";
    }
    const result = await rpc<ContractDataResult>("getLedgerEntries", { keys: [key] });
    return Array.isArray(result.entries) && result.entries.length > 0;
  } catch {
    return false;
  }
}
