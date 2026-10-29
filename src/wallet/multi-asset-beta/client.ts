// Multi-Asset Vault BETA — Soroban RPC client (self-contained; removable beta folder).

import {
  Address,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc as StellarRpc,
  xdr,
} from "@stellar/stellar-sdk";
import { assembleCappedSorobanTx } from "@/src/wallet/soroban-fee-cap";
import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import {
  getActiveDeployment,
  getActiveNetwork,
} from "@/src/wallet/contract-config";
import {
  MULTI_ASSET_MAINNET_CONTRACT_ID,
  isBetaContractDeployed,
} from "@/src/wallet/multi-asset-beta/contract-config";
import { isNativeXlmSac, lockMinimumBlockReason } from "@/src/vault/lock-minimum";
import { isNativeXlmAddress } from "@/src/wallet/multi-asset-beta/TokenPicker";
import { getCurrentRpcUrl } from "@/src/wallet/rpc-failover";

const BASE_FEE = "10000";
const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 30;

/**
 * Best-effort trust-line-error detector. Any raw Stellar / Soroban
 * error message that mentions trust lines is treated as a trust-line
 * problem so callers can render the actionable withdraw-error UI.
 */
export function isTrustLineError(raw: string): boolean {
  const s = raw.toLowerCase();
  return (
    s.includes("trust line") ||
    s.includes("trustline") ||
    s.includes("no_trust") ||
    s.includes("op_no_trust") ||
    s.includes("trustlinemissing")
  );
}

/**
 * Translate a raw error message produced by the Soroban / Horizon
 * layer into a sentence a first-time user can act on. When we can't
 * match a known pattern we return a generic-but-honest fallback that
 * includes the raw text so support / power-users can still triage.
 */
export function humanizeBetaError(raw: string): string {
  if (!raw) return "Something went wrong. Please try again.";
  if (isTrustLineError(raw)) {
    return (
      "Your wallet isn't set up to hold this token yet. Open the token " +
      'in your wallet (Freighter, Lobstr, etc.) and tap "Add asset". ' +
      "This will establish a trust line, then come back here and try again."
    );
  }
  const s = raw.toLowerCase();
  if (s.includes("insufficient balance") || s.includes("insufficientbalance")) {
    return (
      "You don't have enough of this token in your wallet to complete " +
      "this action. Double-check the amount and your token balance."
    );
  }
  if (
    s.includes("insufficient fee") ||
    s.includes("insufficientfee") ||
    s.includes("tx_insufficient_fee")
  ) {
    return (
      "The network fee bid was too low for current conditions. Please " +
      "try again in a moment — the app will bump the fee."
    );
  }
  if (s.includes("tx_insufficient_balance") || s.includes("underfunded")) {
    return (
      "You don't have enough XLM in your wallet to cover the network " +
      "fee. Add a small amount of XLM (about 1 XLM is plenty) and try again."
    );
  }
  if (
    s.includes("bad_seq") ||
    s.includes("tx_bad_seq") ||
    s.includes("stale sequence")
  ) {
    return (
      "The network got a stale copy of your wallet's counter. Please " +
      "try again — this usually resolves within a few seconds."
    );
  }
  if (s.includes("no source account") || s.includes("tx_no_source_account")) {
    return (
      "This wallet isn't active on the Stellar network yet. Send a small " +
      "amount of XLM to it first to activate it."
    );
  }
  if (s.includes("unauthorized") || s.includes("auth")) {
    return (
      "The wallet signature didn't match. Make sure this is the wallet " +
      "that owns the funds."
    );
  }
  if (s.includes("timeout") || s.includes("timed out")) {
    return (
      "The Stellar network took too long to confirm. Your funds are safe. " +
      "Please try again in a moment."
    );
  }
  return (
    "Something went wrong on the Stellar network. Please try again in " +
    "a moment. If the problem persists, contact support with this detail:" +
    `\n\n${raw}`
  );
}

export interface CreateBetaVaultInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  tokenContractId: string;
  name: string;
  /** Amount in the token's smallest unit. */
  amount: bigint;
  unlockTimestamp: number;
}

export interface CreateBetaVaultResult {
  ok: boolean;
  vaultId?: bigint;
  txHash?: string;
  /** Raw error string from the network — for logs / advanced UI. */
  errorRaw?: string;
  /** Human-readable message safe to render in a toast. */
  error?: string;
}

function assertBetaCallable(): void {
  if (getActiveNetwork() !== "mainnet") {
    throw new Error("Multi-asset beta only operates on Stellar Mainnet.");
  }
  if (!isBetaContractDeployed()) {
    throw new Error(
      "This feature isn't available on your app version yet. Please " +
        "update or wait for the next release.",
    );
  }
}

function rpcUrl(): string {
  return getCurrentRpcUrl();
}
function networkPassphrase(): string {
  return getActiveDeployment().networkPassphrase;
}

export async function createBetaVault(
  input: CreateBetaVaultInput,
): Promise<CreateBetaVaultResult> {
  if (isNativeXlmSac(input.tokenContractId)) {
    const blocked = lockMinimumBlockReason(input.amount, input.ownerPublicKey);
    if (blocked) return { ok: false, error: blocked, errorRaw: blocked };
  }
  try {
    assertBetaCallable();
    if (!StrKey.isValidContract(input.tokenContractId)) {
      return {
        ok: false,
        errorRaw: "Invalid contract address",
        error:
          "That doesn't look like a valid Stellar token address. Paste " +
          "the 56-character address that starts with C.",
      };
    }

    const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
    const source = await server.getAccount(input.ownerPublicKey);
    const contract = new Contract(MULTI_ASSET_MAINNET_CONTRACT_ID);

    const args = [
      new Address(input.ownerPublicKey).toScVal(),
      new Address(input.tokenContractId).toScVal(),
      nativeToScVal(input.name, { type: "string" }),
      nativeToScVal(input.amount, { type: "i128" }),
      nativeToScVal(input.unlockTimestamp, { type: "u64" }),
    ];

    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call("create_vault", ...args))
      .setTimeout(180)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return {
        ok: false,
        errorRaw: sim.error,
        error: humanizeBetaError(sim.error),
      };
    }
    const assembled = assembleCappedSorobanTx(tx, sim);

    assembled.sign(keypairIfUnlocked(input.ownerSecretSeed));
    const sendRes = await server.sendTransaction(assembled);
    if (sendRes.status === "ERROR") {
      const rawJson = JSON.stringify(sendRes.errorResult ?? {});
      return {
        ok: false,
        errorRaw: rawJson,
        error: humanizeBetaError(rawJson),
      };
    }

    const txHash = sendRes.hash;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const got = await server.getTransaction(txHash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        const success = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
        const rv = success.returnValue as xdr.ScVal | undefined;
        let vaultId: bigint | undefined;
        try {
          if (rv) vaultId = BigInt(rv.u64().toString());
        } catch {
          /* leave vaultId undefined */
        }
        return { ok: true, vaultId, txHash };
      }
      return {
        ok: false,
        errorRaw: `Tx failed with status ${got.status}`,
        error: humanizeBetaError(`Tx failed with status ${got.status}`),
        txHash,
      };
    }
    return {
      ok: false,
      errorRaw: "poll timeout",
      error: humanizeBetaError("timed out waiting for confirmation"),
      txHash,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, errorRaw: raw, error: humanizeBetaError(raw) };
  }
}

export async function listBetaOwned(ownerPublicKey: string): Promise<bigint[]> {
  assertBetaCallable();
  const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
  const source = await server.getAccount(ownerPublicKey);
  const contract = new Contract(MULTI_ASSET_MAINNET_CONTRACT_ID);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(
      contract.call("list_owned", new Address(ownerPublicKey).toScVal()),
    )
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(sim)) return [];
  const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result
    ?.retval;
  if (!rv) return [];
  try {
    const vec = rv.vec() ?? [];
    return vec.map((v) => BigInt(v.u64().toString()));
  } catch {
    return [];
  }
}

export interface BetaVaultRecord {
  vaultId: bigint;
  owner: string;
  /** SAC address of the token this vault holds. */
  tokenContractId: string;
  name: string;
  /** Balance in the token's smallest unit (stroops for 7-decimal SACs). */
  balance: bigint;
  unlockTimestamp: number;
  createdTimestamp: number;
  withdrawn: boolean;
}

/**
 * Fetch a single vault's full record from the multi-asset contract.
 * Returns `null` when the vault id doesn't exist (VaultNotFound) or
 * when the simulation fails for any other reason. Callers should
 * treat null as "skip this row" rather than an error condition —
 * a partial list is preferable to a total failure banner.
 */
export async function getBetaVault(
  ownerPublicKey: string,
  vaultId: bigint,
): Promise<BetaVaultRecord | null> {
  try {
    assertBetaCallable();
    const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
    const source = await server.getAccount(ownerPublicKey);
    const contract = new Contract(MULTI_ASSET_MAINNET_CONTRACT_ID);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call("get_vault", nativeToScVal(vaultId, { type: "u64" })),
      )
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) return null;
    const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result
      ?.retval;
    if (!rv) return null;

    // The `Vault` struct is encoded as a Soroban map (ScVal::Map)
    // when serialized from the contract. `scValToNative` from the
    // stellar-sdk unpacks it into a JS object with camelCase keys
    // matching the field names declared in lib.rs.
    const { scValToNative } = await import("@stellar/stellar-sdk");
    const native = scValToNative(rv) as Record<string, unknown> | null;
    if (!native || typeof native !== "object") return null;

    const owner = String(native.owner ?? "");
    const token = String(native.token ?? "");
    const name = String(native.name ?? "");
    const balance = BigInt(String(native.balance ?? "0"));
    const unlockTs = Number(native.unlock_timestamp ?? 0);
    const createdTs = Number(native.created_timestamp ?? 0);
    const vId = BigInt(String(native.vault_id ?? vaultId));
    const withdrawn = Boolean(native.withdrawn ?? false);

    return {
      vaultId: vId,
      owner,
      tokenContractId: token,
      name,
      balance,
      unlockTimestamp: unlockTs,
      createdTimestamp: createdTs,
      withdrawn,
    };
  } catch (e) {
    if (__DEV__) {
      console.warn("[multi-asset-beta] getBetaVault failed", vaultId, e);
    }
    return null;
  }
}

/**
 * List every multi-asset beta vault owned by `ownerPublicKey`.
 *
 * Implementation:
 *   1. Call `list_owned` on the contract to get vault ids.
 *   2. Fan out `get_vault` reads in parallel (bounded — the average
 *      user will have < 5 vaults; even a heavy user won't cross
 *      into Soroban RPC rate limits).
 *   3. Filter out any nulls (skipped rows) and return a stable list
 *      sorted DESC by creation time so newest vaults sit on top.
 *
 * Returns an empty array on any error — the dashboard renders "no
 * beta vaults" for that case, which is the correct empty state.
 */
export async function listBetaVaults(
  ownerPublicKey: string,
): Promise<BetaVaultRecord[]> {
  try {
    const ids = await listBetaOwned(ownerPublicKey);
    if (ids.length === 0) return [];
    const settled = await Promise.all(
      ids.map((id) => getBetaVault(ownerPublicKey, id)),
    );
    const rows = settled.filter(
      (v): v is BetaVaultRecord => v !== null,
    );
    // Sort DESC by creation time so newest vaults appear on top.
    // Falls back to vault_id when timestamps are equal (should be
    // impossible under normal conditions but keeps the ordering
    // stable across renders).
    rows.sort((a, b) => {
      if (a.createdTimestamp !== b.createdTimestamp) {
        return b.createdTimestamp - a.createdTimestamp;
      }
      return a.vaultId < b.vaultId ? 1 : -1;
    });
    return rows;
  } catch (e) {
    if (__DEV__) {
      console.warn("[multi-asset-beta] listBetaVaults failed", e);
    }
    return [];
  }
}

/**
 * Trust-line pre-check for withdrawals.
 *
 * Short-circuit for the native XLM SAC. Native
 * XLM doesn't need a trust line (every Stellar account carries XLM
 * by default), so we skip the sim call entirely.
 */
export async function checkTrustLine(
  ownerPublicKey: string,
  tokenContractId: string,
): Promise<{ ok: true } | { ok: false; error: string; errorRaw: string }> {
  try {
    if (!StrKey.isValidContract(tokenContractId)) {
      return {
        ok: false,
        errorRaw: "invalid contract address",
        error: "That doesn't look like a valid Stellar token address.",
      };
    }
    if (isNativeXlmAddress(tokenContractId)) return { ok: true };
    const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
    const source = await server.getAccount(ownerPublicKey);
    const tokenContract = new Contract(tokenContractId);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        tokenContract.call("balance", new Address(ownerPublicKey).toScVal()),
      )
      .setTimeout(60)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return {
        ok: false,
        errorRaw: sim.error,
        error: humanizeBetaError(
          isTrustLineError(sim.error) ? sim.error : "trustline_missing " + sim.error,
        ),
      };
    }
    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, errorRaw: raw, error: humanizeBetaError(raw) };
  }
}

export interface WithdrawBetaVaultInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  tokenContractId: string;
  vaultId: bigint;
}

export async function withdrawBetaVault(
  input: WithdrawBetaVaultInput,
): Promise<CreateBetaVaultResult> {
  try {
    assertBetaCallable();
    const trust = await checkTrustLine(
      input.ownerPublicKey,
      input.tokenContractId,
    );
    if (!trust.ok) {
      return { ok: false, errorRaw: trust.errorRaw, error: trust.error };
    }

    const server = new StellarRpc.Server(rpcUrl(), { allowHttp: false });
    const source = await server.getAccount(input.ownerPublicKey);
    const contract = new Contract(MULTI_ASSET_MAINNET_CONTRACT_ID);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call(
          "withdraw",
          new Address(input.ownerPublicKey).toScVal(),
          nativeToScVal(input.vaultId, { type: "u64" }),
        ),
      )
      .setTimeout(180)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return {
        ok: false,
        errorRaw: sim.error,
        error: humanizeBetaError(sim.error),
      };
    }
    const assembled = assembleCappedSorobanTx(tx, sim);
    assembled.sign(keypairIfUnlocked(input.ownerSecretSeed));

    const sendRes = await server.sendTransaction(assembled);
    if (sendRes.status === "ERROR") {
      const rawJson = JSON.stringify(sendRes.errorResult ?? {});
      return { ok: false, errorRaw: rawJson, error: humanizeBetaError(rawJson) };
    }
    return { ok: true, txHash: sendRes.hash };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, errorRaw: raw, error: humanizeBetaError(raw) };
  }
}
