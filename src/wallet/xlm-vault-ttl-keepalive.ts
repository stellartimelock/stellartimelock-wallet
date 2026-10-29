// Standard XLM Vault — Soroban persistent-storage TTL keep-alive.
//
// The deployed `xlm_vault` contract never calls `extend_ttl`; default TTL
// (~118 days) can expire before long lock periods. This module submits
// protocol-level `ExtendFootprintTtlOp` bumps (24h threshold, ~170-day horizon).

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
import { getCurrentRpcUrl } from "@/src/wallet/rpc-failover";

const BASE_FEE = "100000";
/** Only bump when remaining TTL drops below this window. */
const BUMP_THRESHOLD_SECONDS = 24 * 60 * 60; // 24 hours
const LEDGER_CLOSE_SECONDS = 5;
/** How far to push TTL out on each bump — roughly ~170 days of ledgers. */
const EXTEND_TO_LEDGERS = 3_000_000;

function xlmContractId(): string {
  return getActiveDeployment().contractId;
}
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
      contract: new Address(xlmContractId()).toScAddress(),
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
      contract: new Address(xlmContractId()).toScAddress(),
      key: keyScVal,
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

export interface XlmVaultTtlBumpResult {
  checked: number;
  bumped: boolean;
  minRemainingHours: number | null;
  txHash?: string;
  feeStroops?: string;
  error?: string;
}

/**
 * Checks the remaining TTL of the owner's index entry + every XLM
 * vault id's entry. If ANY are within `BUMP_THRESHOLD_SECONDS` of
 * expiring, submits ONE signed `extendFootprintTtl` transaction
 * covering all of them in a single footprint. No-ops (zero network
 * writes, zero fee) when everything is healthy — safe to call on every
 * dashboard mount/focus/pull-to-refresh.
 *
 * Requires the owner's secret seed to sign the bump transaction —
 * silently no-ops the bump for watch-only sessions (still returns the
 * healthy read result). `vaultIds` may be an empty array; when empty
 * we still probe the `Owned(owner)` index so the "list" call after
 * this succeeds.
 */
export async function checkAndBumpXlmVaultTtl(
  ownerPublicKey: string,
  ownerSecretSeed: string,
  vaultIds: bigint[],
): Promise<XlmVaultTtlBumpResult> {
  const keys: xdr.LedgerKey[] = [ownedKey(ownerPublicKey)];
  for (const id of vaultIds) keys.push(vaultKey(id));
  if (keys.length === 0) {
    return { checked: 0, bumped: false, minRemainingHours: null };
  }

  const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
  let latest;
  try {
    latest = await server.getLatestLedger();
  } catch (e) {
    return {
      checked: keys.length,
      bumped: false,
      minRemainingHours: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let entries;
  try {
    ({ entries } = await server.getLedgerEntries(...keys));
  } catch (e) {
    return {
      checked: keys.length,
      bumped: false,
      minRemainingHours: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (entries.length === 0) {
    // Owner index doesn't exist on-chain (fresh wallet with no vaults).
    // Healthy no-op.
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
      `[xlm-vault-ttl] entry within ${minRemainingHours.toFixed(1)}h of expiry — bumping TTL for ${ownerPublicKey}`,
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
