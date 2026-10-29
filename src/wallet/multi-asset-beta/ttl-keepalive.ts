// Multi-Asset Vault BETA — Soroban persistent-storage TTL keep-alive.
//
// The deployed `multi_asset_vault` contract never calls `extend_ttl` on
// persistent entries. Soroban's default TTL (~118 days) can expire before
// long lock periods elapse, causing `list_owned` / `get_vault` reads to
// fail silently. This module submits protocol-level `ExtendFootprintTtlOp`
// bumps as a frontend safety net. Fee-minimization: only bump when an
// entry is within 24h of expiring.

import {
  Address,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc as StellarRpc,
  xdr,
} from "@stellar/stellar-sdk";
import { assembleCappedSorobanTx } from "@/src/wallet/soroban-fee-cap";
import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import { getActiveDeployment } from "@/src/wallet/contract-config";
import { MULTI_ASSET_MAINNET_CONTRACT_ID } from "@/src/wallet/multi-asset-beta/contract-config";
import { getCurrentRpcUrl } from "@/src/wallet/rpc-failover";

const BASE_FEE = "100000";
/** Only bump when remaining TTL drops below this window. */
const BUMP_THRESHOLD_SECONDS = 24 * 60 * 60; // 24 hours
const LEDGER_CLOSE_SECONDS = 5;
/** How far to push TTL out on each bump — roughly ~170 days of ledgers. */
const EXTEND_TO_LEDGERS = 3_000_000;

function rpcUrl(): string {
  return getCurrentRpcUrl();
}
function networkPassphrase(): string {
  return getActiveDeployment().networkPassphrase;
}

function ownedKey(ownerPublicKey: string): xdr.LedgerKey {
  const keyScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Owned"),
    new Address(ownerPublicKey).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(MULTI_ASSET_MAINNET_CONTRACT_ID).toScAddress(),
      key: keyScVal,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

function vaultKey(vaultId: bigint): xdr.LedgerKey {
  const keyScVal = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Vault"),
    xdr.ScVal.scvU64(new xdr.Uint64(vaultId.toString())),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(MULTI_ASSET_MAINNET_CONTRACT_ID).toScAddress(),
      key: keyScVal,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

export interface TtlBumpResult {
  checked: number;
  bumped: boolean;
  minRemainingHours: number | null;
  txHash?: string;
  /** Actual total fee (stroops) charged by the bump tx. */
  feeStroops?: string;
  error?: string;
}

/**
 * Checks the remaining TTL of the owner's index entry + every vault
 * id's entry. If ANY are within `BUMP_THRESHOLD_SECONDS` of expiring,
 * submits ONE signed `extendFootprintTtl` transaction covering all of
 * them in a single footprint (one fee, not one per entry). No-ops
 * (zero network writes, zero fee) when everything is healthy — safe
 * to call on every dashboard mount/focus/pull-to-refresh.
 */
export async function checkAndBumpBetaTtl(
  ownerPublicKey: string,
  ownerSecretSeed: string,
  vaultIds: bigint[],
): Promise<TtlBumpResult> {
  const keys = [ownedKey(ownerPublicKey), ...vaultIds.map(vaultKey)];
  if (keys.length === 0) {
    return { checked: 0, bumped: false, minRemainingHours: null };
  }

  const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
  const latest = await server.getLatestLedger();
  const { entries } = await server.getLedgerEntries(...keys);
  if (entries.length === 0) {
    return { checked: keys.length, bumped: false, minRemainingHours: null };
  }

  let minRemainingLedgers = Infinity;
  for (const e of entries) {
    const remaining = (e.liveUntilLedgerSeq ?? 0) - latest.sequence;
    if (remaining < minRemainingLedgers) minRemainingLedgers = remaining;
  }
  const minRemainingHours = (minRemainingLedgers * LEDGER_CLOSE_SECONDS) / 3600;

  if (minRemainingHours * 3600 > BUMP_THRESHOLD_SECONDS) {
    return { checked: keys.length, bumped: false, minRemainingHours };
  }

  if (__DEV__) {
    console.log(
      `[ttl-keepalive] entry within ${minRemainingHours.toFixed(1)}h of expiry — bumping TTL for ${ownerPublicKey}`,
    );
  }

  try {
    const source = await server.getAccount(ownerPublicKey);
    const sorobanData = new SorobanDataBuilder().setReadOnly(keys).build();
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .setSorobanData(sorobanData)
      .addOperation(Operation.extendFootprintTtl({ extendTo: EXTEND_TO_LEDGERS }))
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return { checked: keys.length, bumped: false, minRemainingHours, error: sim.error };
    }
    const assembled = assembleCappedSorobanTx(tx, sim);
    assembled.sign(keypairIfUnlocked(ownerSecretSeed));
    const sendRes = await server.sendTransaction(assembled);
    if (sendRes.status === "ERROR") {
      return {
        checked: keys.length,
        bumped: false,
        minRemainingHours,
        error: JSON.stringify(sendRes.errorResult ?? {}),
      };
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await server.getTransaction(sendRes.hash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        return {
          checked: keys.length,
          bumped: true,
          minRemainingHours,
          txHash: sendRes.hash,
          feeStroops: assembled.fee,
        };
      }
      return {
        checked: keys.length,
        bumped: false,
        minRemainingHours,
        error: `Tx failed with status ${got.status}`,
      };
    }
    return { checked: keys.length, bumped: false, minRemainingHours, error: "poll timeout" };
  } catch (e) {
    return {
      checked: keys.length,
      bumped: false,
      minRemainingHours,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Per-vault TTL refresh and local renewal history log. */

/** Roughly how many ledgers correspond to 30 days — used to gate the
 * manual "Refresh" button's visibility (only shown once TTL is within
 * this window of expiring). */
export const TTL_WARNING_WINDOW_HOURS = 30 * 24;

async function readMinRemainingHours(
  server: InstanceType<typeof StellarRpc.Server>,
  keys: xdr.LedgerKey[],
): Promise<number | null> {
  const latest = await server.getLatestLedger();
  const { entries } = await server.getLedgerEntries(...keys);
  if (entries.length === 0) return null;
  let minRemainingLedgers = Infinity;
  for (const e of entries) {
    const remaining = (e.liveUntilLedgerSeq ?? 0) - latest.sequence;
    if (remaining < minRemainingLedgers) minRemainingLedgers = remaining;
  }
  if (!Number.isFinite(minRemainingLedgers)) return null;
  return (minRemainingLedgers * LEDGER_CLOSE_SECONDS) / 3600;
}

export interface VaultTtlStatus {
  minRemainingHours: number | null;
  /** Epoch ms the entry's TTL currently extends to, projected from the
   * remaining ledger count — i.e. "renewed until ~this date" for display. */
  renewedUntilMs: number | null;
  error?: string;
}

/**
 * Read-only (zero fee, no transaction) TTL check for a SINGLE vault, used
 * by the vault card's "On-chain data renewed until ~[Month Year]" caption
 * and to decide whether the "Refresh" button should be visible.
 */
export async function getVaultTtlStatus(
  ownerPublicKey: string,
  vaultId: bigint,
): Promise<VaultTtlStatus> {
  try {
    const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
    const keys = [ownedKey(ownerPublicKey), vaultKey(vaultId)];
    const minRemainingHours = await readMinRemainingHours(server, keys);
    const renewedUntilMs =
      minRemainingHours != null
        ? Date.now() + minRemainingHours * 3600 * 1000
        : null;
    return { minRemainingHours, renewedUntilMs };
  } catch (e) {
    return {
      minRemainingHours: null,
      renewedUntilMs: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface TtlBumpPreflight {
  ok: boolean;
  minRemainingHours: number | null;
  /** Total fee (stroops) the assembled transaction will actually charge —
   * shown to the user BEFORE they confirm the bump. */
  estimatedFeeStroops?: string;
  /** Fully-assembled, unsigned transaction XDR. Pass straight into
   * `submitPreflightedTtlBump` after the user confirms — avoids a second
   * (redundant) simulation round-trip. */
  assembledTxXdr?: string;
  error?: string;
}

/**
 * Simulates (but does NOT sign or send) an `extendFootprintTtl` transaction
 * for a single vault, so the caller can show the real network fee in a
 * confirmation prompt before spending it. Pure read/simulate — no fee is
 * charged by this call itself.
 */
export async function preflightVaultTtlBump(
  ownerPublicKey: string,
  vaultId: bigint,
): Promise<TtlBumpPreflight> {
  const keys = [ownedKey(ownerPublicKey), vaultKey(vaultId)];
  const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
  let minRemainingHours: number | null = null;
  try {
    minRemainingHours = await readMinRemainingHours(server, keys);
  } catch {
    /* best-effort — a failure here just means the caption stays blank */
  }
  try {
    const source = await server.getAccount(ownerPublicKey);
    const sorobanData = new SorobanDataBuilder().setReadOnly(keys).build();
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .setSorobanData(sorobanData)
      .addOperation(Operation.extendFootprintTtl({ extendTo: EXTEND_TO_LEDGERS }))
      .setTimeout(120)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return { ok: false, minRemainingHours, error: sim.error };
    }
    const assembled = assembleCappedSorobanTx(tx, sim);
    return {
      ok: true,
      minRemainingHours,
      estimatedFeeStroops: assembled.fee,
      assembledTxXdr: assembled.toXDR(),
    };
  } catch (e) {
    return {
      ok: false,
      minRemainingHours,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface TtlBumpSubmitResult {
  ok: boolean;
  txHash?: string;
  feeStroops?: string;
  error?: string;
}

/**
 * Signs + sends a transaction previously produced by
 * `preflightVaultTtlBump`. Split into two steps so the UI can show the
 * exact fee (from the preflight) in a confirm prompt without paying twice
 * for two separate simulations.
 */
export async function submitPreflightedTtlBump(
  ownerSecretSeed: string,
  assembledTxXdr: string,
): Promise<TtlBumpSubmitResult> {
  try {
    const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
    const tx = TransactionBuilder.fromXDR(assembledTxXdr, networkPassphrase());
    tx.sign(keypairIfUnlocked(ownerSecretSeed));
    const sendRes = await server.sendTransaction(tx);
    if (sendRes.status === "ERROR") {
      return { ok: false, error: JSON.stringify(sendRes.errorResult ?? {}) };
    }
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const got = await server.getTransaction(sendRes.hash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        return { ok: true, txHash: sendRes.hash, feeStroops: tx.fee };
      }
      return { ok: false, error: `Tx failed with status ${got.status}` };
    }
    return { ok: false, error: "poll timeout" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Formats a stroop amount (string or number) as an XLM string, e.g.
 * "0.00521". Never throws — falls back to "0" on bad input. */
export function stroopsToXlmString(stroops: string | number): string {
  try {
    const n = typeof stroops === "string" ? parseInt(stroops, 10) : stroops;
    if (!Number.isFinite(n)) return "0";
    return (n / 10_000_000).toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  } catch {
    return "0";
  }
}

// Local renewal log — `ExtendFootprintTtlOp` does not appear in Horizon payments.

export interface TtlRenewalLogEntry {
  id: string;
  vaultId: string;
  vaultName: string;
  feeStroops: string;
  txHash?: string;
  timestampMs: number;
}

const RENEWAL_LOG_MAX_ENTRIES = 50;

function renewalLogKey(ownerPublicKey: string): string {
  return `beta_ttl_renewal_log_v1_${ownerPublicKey}`;
}

/** Appends one renewal record to the owner's local log, capped to the
 * most recent `RENEWAL_LOG_MAX_ENTRIES`. Best-effort — a storage failure
 * here never blocks the (already-completed) on-chain bump. */
export async function recordTtlRenewal(
  ownerPublicKey: string,
  entry: Omit<TtlRenewalLogEntry, "id">,
): Promise<void> {
  try {
    const { storage } = await import("@/src/utils/storage");
    const key = renewalLogKey(ownerPublicKey);
    const existing = await listTtlRenewals(ownerPublicKey);
    const full: TtlRenewalLogEntry = {
      ...entry,
      id: `${entry.timestampMs}_${entry.vaultId}_${Math.random().toString(36).slice(2, 8)}`,
    };
    const next = [full, ...existing].slice(0, RENEWAL_LOG_MAX_ENTRIES);
    await storage.setItem(key, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
}

/** Reads the owner's local renewal log, newest first. Never throws. */
export async function listTtlRenewals(
  ownerPublicKey: string,
): Promise<TtlRenewalLogEntry[]> {
  try {
    const { storage } = await import("@/src/utils/storage");
    const key = renewalLogKey(ownerPublicKey);
    const raw = await storage.getItem<string>(key, "");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TtlRenewalLogEntry[];
  } catch {
    return [];
  }
}
