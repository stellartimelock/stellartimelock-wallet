// Advanced Vaults — Soroban RPC client for `multi_asset_vault_v2`.

import {
  Address,
  Contract,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc as StellarRpc,
  xdr,
} from "@stellar/stellar-sdk";
import { isNativeXlmSac, lockMinimumBlockReason } from "@/src/vault/lock-minimum";
import { assembleCappedSorobanTx } from "@/src/wallet/soroban-fee-cap";
import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import {
  getAdvancedDeployment,
  getDualApprovalWasmHash,
  getHtlcDeployment,
  isHtlcContractDeployed,
  type AdvancedVaultKind,
} from "@/src/wallet/advanced-vaults/contract-config";
import { getRpcOverrideSync, isHttpsRpcUrl } from "@/src/wallet/advanced-settings-prefs";

import { Operation } from "@stellar/stellar-sdk";

const BASE_FEE = "10000";
const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 30;

/** Blocks a new XLM lock under 10 XLM. A non-XLM token amount is left alone. */
function xlmLockMinimumError(
  amount: bigint,
  ownerPublicKey: string,
  tokenContractId?: string,
): string | null {
  if (tokenContractId && !isNativeXlmSac(tokenContractId)) return null;
  return lockMinimumBlockReason(amount, ownerPublicKey);
}

function deployment() {
  return getAdvancedDeployment();
}
function rpcUrl(): string {
  const override = getRpcOverrideSync();
  if (override && isHttpsRpcUrl(override)) return override;
  return deployment().rpcUrl;
}
function networkPassphrase(): string {
  return deployment().networkPassphrase;
}
function contractId(): string {
  return deployment().contractId;
}
function server(): StellarRpc.Server {
  return new StellarRpc.Server(rpcUrl(), { allowHttp: false });
}

/** Contract error codes from `/app/contracts/multi_asset_vault_v2/src/lib.rs`. */
const CONTRACT_ERROR_MESSAGES: Record<number, string> = {
  1: "You're not the owner of this vault.",
  2: "This vault is still time-locked.",
  3: "This vault has already been withdrawn.",
  4: "You can only extend a lock, never shorten it.",
  5: "That vault could not be found on-chain.",
  6: "Enter an amount greater than zero.",
  7: "That timestamp isn't valid.",
  9: "That doesn't look like a valid Stellar token address.",
  10: "That action doesn't apply to this vault type.",
  11: "No withdrawal has been started yet — tap \"Start withdrawal\" first.",
  12: "Still in the Time Gate. Please wait for the countdown to finish.",
  13: "The Unlock Intervals end date must be after the start date.",
  14: "That's more than what's currently unlocked. Try a smaller amount.",
  15: "This vault has no backup address configured.",
  16: "Only the designated backup address can claim this vault.",
  17: "The inactivity deadline hasn't passed yet.",
  18: "This vault was already claimed by the backup address.",
  19: "The backup address can't be the same as the owner.",
};

function extractContractErrorCode(raw: string): number | null {
  const m = raw.match(/Error\(Contract,\s*#(\d+)\)/i);
  if (!m) return null;
  const code = parseInt(m[1], 10);
  return Number.isFinite(code) ? code : null;
}

/** Safely extract a message from ANY thrown value — a real `Error`, a
 * plain RPC-rejection object like `{code:404,message:"Account not
 * found: G..."}` (this is what `@stellar/stellar-sdk`'s `getAccount()`
 * rejects with — NOT an `Error` instance, so `instanceof Error` checks
 * silently produce "[object Object]" if not handled here), or anything
 * else. */
export function stringifyRpcError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") {
      return obj.code != null ? `${obj.message} (code ${obj.code})` : obj.message;
    }
    try {
      return JSON.stringify(obj);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}

export function humanizeAdvancedError(raw: string): string {
  if (!raw) return "Something went wrong. Please try again.";
  const code = extractContractErrorCode(raw);
  if (code != null && CONTRACT_ERROR_MESSAGES[code]) {
    return CONTRACT_ERROR_MESSAGES[code];
  }
  const s = raw.toLowerCase();
  if (s.includes("account not found") || s.includes("code 404") || s.includes('"code":404')) {
    return deployment().network === "mainnet"
      ? "This wallet has no XLM on Stellar Mainnet yet. Add some funds first, then try again."
      : "This wallet doesn't exist on Testnet yet — we'll auto-fund it and retry.";
  }
  if (s.includes("insufficient balance") || s.includes("insufficientbalance")) {
    return "You don't have enough XLM to complete this action.";
  }
  if (s.includes("tx_insufficient_balance") || s.includes("underfunded")) {
    return deployment().network === "mainnet"
      ? "You don't have enough XLM to cover the network fee."
      : "You don't have enough XLM in your Testnet wallet to cover the network fee.";
  }
  if (s.includes("bad_seq") || s.includes("tx_bad_seq")) {
    return "The network got a stale copy of your wallet's counter. Please try again.";
  }
  if (s.includes("timeout") || s.includes("timed out")) {
    return "The Stellar network took too long to confirm. Your funds are safe — try again.";
  }
  return (
    "Something went wrong on the Stellar network. Please try again. " +
    `Detail: ${raw.slice(0, 200)}`
  );
}

async function ensureTestnetFunded(publicKey: string): Promise<void> {
  const dep = deployment();
  if (dep.network !== "testnet" || !dep.friendbotUrl) return;
  try {
    await server().getAccount(publicKey);
    return; // account already exists
  } catch {
    /* fall through to friendbot funding */
  }
  try {
    await fetch(`${dep.friendbotUrl}/?addr=${publicKey}`);
    // Give the ledger a moment to close before the caller re-reads it.
    await new Promise((r) => setTimeout(r, 2000));
  } catch {
    /* best-effort — the actual create call will surface a clear error */
  }
}

export interface AdvancedResult {
  ok: boolean;
  vaultId?: bigint;
  txHash?: string;
  errorRaw?: string;
  error?: string;
}

async function submitInvocation(
  methodName: string,
  args: xdr.ScVal[],
  ownerPublicKey: string,
  ownerSecretSeed: string,
): Promise<AdvancedResult> {
  try {
    if (!isAdvancedContractReachable()) {
      return {
        ok: false,
        errorRaw: "not deployed",
        error: "Advanced Vaults aren't available yet on this app version.",
      };
    }
    await ensureTestnetFunded(ownerPublicKey);
    const srv = server();
    const source = await srv.getAccount(ownerPublicKey);
    const contract = new Contract(contractId());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call(methodName, ...args))
      .setTimeout(180)
      .build();

    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return { ok: false, errorRaw: sim.error, error: humanizeAdvancedError(sim.error) };
    }
    const assembled = assembleCappedSorobanTx(tx, sim);
    assembled.sign(keypairIfUnlocked(ownerSecretSeed));

    const sendRes = await srv.sendTransaction(assembled);
    if (sendRes.status === "ERROR") {
      const rawJson = JSON.stringify(sendRes.errorResult ?? {});
      return { ok: false, errorRaw: rawJson, error: humanizeAdvancedError(rawJson) };
    }

    const txHash = sendRes.hash;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const got = await srv.getTransaction(txHash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        const success = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
        const rv = success.returnValue as xdr.ScVal | undefined;
        let vaultId: bigint | undefined;
        try {
          if (rv) {
            const native = scValToNative(rv);
            if (typeof native === "bigint") vaultId = native;
          }
        } catch {
          /* leave vaultId undefined — not every call returns one */
        }
        return { ok: true, vaultId, txHash };
      }
      return {
        ok: false,
        errorRaw: `Tx failed with status ${got.status}`,
        error: humanizeAdvancedError(`Tx failed with status ${got.status}`),
        txHash,
      };
    }
    return {
      ok: false,
      errorRaw: "poll timeout",
      error: humanizeAdvancedError("timed out waiting for confirmation"),
      txHash,
    };
  } catch (e) {
    const raw = stringifyRpcError(e);
    return { ok: false, errorRaw: raw, error: humanizeAdvancedError(raw) };
  }
}

export function isAdvancedContractReachable(): boolean {
  const dep = deployment();
  return dep.enabled && dep.contractId.length === 56;
}

export interface CreateCoolingOffInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  name: string;
  /** Amount in stroops (native XLM, 7 decimals). */
  amount: bigint;
  coolingOffDurationSeconds: number;
}

export async function createCoolingOffVault(
  input: CreateCoolingOffInput,
): Promise<AdvancedResult> {
  const blocked = xlmLockMinimumError(input.amount, input.ownerPublicKey);
  if (blocked) return { ok: false, error: blocked, errorRaw: blocked };
  const token = deployment().nativeXlmSac;
  return submitInvocation(
    "create_cooling_off_vault",
    [
      new Address(input.ownerPublicKey).toScVal(),
      new Address(token).toScVal(),
      nativeToScVal(input.name, { type: "string" }),
      nativeToScVal(input.amount, { type: "i128" }),
      nativeToScVal(input.coolingOffDurationSeconds, { type: "u64" }),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export interface CreateVestingInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  name: string;
  amount: bigint;
  vestingStartTimestamp: number;
  vestingEndTimestamp: number;
  /** Optional non-native Stellar Asset Contract (SAC) address.
   *  When omitted, the native XLM SAC is used (classic Vesting). */
  tokenContractId?: string;
}

export async function createVestingVault(
  input: CreateVestingInput,
): Promise<AdvancedResult> {
  const blocked = xlmLockMinimumError(
    input.amount,
    input.ownerPublicKey,
    input.tokenContractId,
  );
  if (blocked) return { ok: false, error: blocked, errorRaw: blocked };
  const token = input.tokenContractId ?? deployment().nativeXlmSac;
  return submitInvocation(
    "create_vesting_vault",
    [
      new Address(input.ownerPublicKey).toScVal(),
      new Address(token).toScVal(),
      nativeToScVal(input.name, { type: "string" }),
      nativeToScVal(input.amount, { type: "i128" }),
      nativeToScVal(input.vestingStartTimestamp, { type: "u64" }),
      nativeToScVal(input.vestingEndTimestamp, { type: "u64" }),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export interface CreateMultiAssetVestingInput extends CreateVestingInput {
  tokenContractId: string;
}

/**
 * Multi-Asset Vesting — a vesting schedule that works with non-XLM
 * Stellar tokens (SACs like USDC / EURC / AQUA). Reuses the same
 * `create_vesting_vault` on-chain method as the XLM Vesting Schedule,
 * but passes the chosen token's SAC address instead of the native XLM SAC.
 */
export async function createMultiAssetVestingVault(
  input: CreateMultiAssetVestingInput,
): Promise<AdvancedResult> {
  return createVestingVault({
    ownerPublicKey: input.ownerPublicKey,
    ownerSecretSeed: input.ownerSecretSeed,
    name: input.name,
    amount: input.amount,
    vestingStartTimestamp: input.vestingStartTimestamp,
    vestingEndTimestamp: input.vestingEndTimestamp,
    tokenContractId: input.tokenContractId,
  });
}

export interface CreateDeadManSwitchInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  name: string;
  amount: bigint;
  backupAddress: string;
  inactivityPeriodSeconds: number;
}

export async function createDeadManSwitchVault(
  input: CreateDeadManSwitchInput,
): Promise<AdvancedResult> {
  const blocked = xlmLockMinimumError(input.amount, input.ownerPublicKey);
  if (blocked) return { ok: false, error: blocked, errorRaw: blocked };
  const token = deployment().nativeXlmSac;
  return submitInvocation(
    "create_dead_man_switch_vault",
    [
      new Address(input.ownerPublicKey).toScVal(),
      new Address(token).toScVal(),
      nativeToScVal(input.name, { type: "string" }),
      nativeToScVal(input.amount, { type: "i128" }),
      new Address(input.backupAddress).toScVal(),
      nativeToScVal(input.inactivityPeriodSeconds, { type: "u64" }),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export interface VaultActionInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  vaultId: bigint;
}

export async function initiateWithdrawal(input: VaultActionInput): Promise<AdvancedResult> {
  return submitInvocation(
    "initiate_withdrawal",
    [new Address(input.ownerPublicKey).toScVal(), nativeToScVal(input.vaultId, { type: "u64" })],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export async function cancelWithdrawal(input: VaultActionInput): Promise<AdvancedResult> {
  return submitInvocation(
    "cancel_withdrawal",
    [new Address(input.ownerPublicKey).toScVal(), nativeToScVal(input.vaultId, { type: "u64" })],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export async function withdrawAdvancedVault(input: VaultActionInput): Promise<AdvancedResult> {
  return submitInvocation(
    "withdraw",
    [new Address(input.ownerPublicKey).toScVal(), nativeToScVal(input.vaultId, { type: "u64" })],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export async function ping(input: VaultActionInput): Promise<AdvancedResult> {
  return submitInvocation(
    "ping",
    [new Address(input.ownerPublicKey).toScVal(), nativeToScVal(input.vaultId, { type: "u64" })],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export interface BackupWithdrawInput {
  backupPublicKey: string;
  backupSecretSeed: string;
  vaultId: bigint;
}

/** Claim a Dead Man's Switch vault as the designated backup address. */
export async function backupWithdraw(input: BackupWithdrawInput): Promise<AdvancedResult> {
  return submitInvocation(
    "backup_withdraw",
    [new Address(input.backupPublicKey).toScVal(), nativeToScVal(input.vaultId, { type: "u64" })],
    input.backupPublicKey,
    input.backupSecretSeed,
  );
}

export interface WithdrawVestedInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  vaultId: bigint;
  amount: bigint;
}

export async function withdrawVested(input: WithdrawVestedInput): Promise<AdvancedResult> {
  return submitInvocation(
    "withdraw_vested",
    [
      new Address(input.ownerPublicKey).toScVal(),
      nativeToScVal(input.vaultId, { type: "u64" }),
      nativeToScVal(input.amount, { type: "i128" }),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

export interface AdvancedVaultRecord {
  vaultId: bigint;
  owner: string;
  token: string;
  name: string;
  balance: bigint;
  kind: AdvancedVaultKind;
  withdrawn: boolean;
  createdTimestamp: number;
  unlockTimestamp: number;
  withdrawalInitiatedTimestamp: number;
  coolingOffDurationSeconds: number;
  totalLockedAmount: bigint;
  vestingStartTimestamp: number;
  vestingEndTimestamp: number;
  withdrawnSoFar: bigint;
  backupAddress: string | null;
  inactivityPeriodSeconds: number;
  lastPingTimestamp: number;
  claimedByBackup: boolean;
  /** true when the wallet is the backup_address (beneficiary), not the on-chain owner */
  isBeneficiary: boolean;
  /** HTLC-only: hex SHA-256 hash locked on-chain. */
  htlcHash?: string;
  /** HTLC-only: settled via recipient claim. */
  htlcClaimed?: boolean;
  /** HTLC-only: settled via sender refund. */
  htlcRefunded?: boolean;
}

const ADVANCED_KIND_NAMES: readonly AdvancedVaultKind[] = [
  "TimeLock",
  "CoolingOff",
  "Vesting",
  "DeadManSwitch",
  "MultiSig",
  "MultiAssetVesting",
  "HTLC",
];

/**
 * Normalize Soroban enum payloads from scValToNative into a canonical
 * AdvancedVaultKind. Handles string tags, [tag, ...] tuples, { tag }, and
 * { VariantName: null } objects — mis-parsed kinds previously fell through
 * to TimeLock and hid Cooling-Off / Vesting / DMS under the wrong tier tab.
 */
function normalizeAdvancedKind(raw: unknown): AdvancedVaultKind {
  if (typeof raw === "string") {
    if ((ADVANCED_KIND_NAMES as readonly string[]).includes(raw)) {
      return raw as AdvancedVaultKind;
    }
    const compact = raw.replace(/[_\s-]/g, "");
    const match = ADVANCED_KIND_NAMES.find(
      (k) => k.toLowerCase() === compact.toLowerCase(),
    );
    if (match) return match;
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return normalizeAdvancedKind(raw[0]);
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.tag === "string") return normalizeAdvancedKind(obj.tag);
    if (typeof obj.name === "string") return normalizeAdvancedKind(obj.name);
    const keys = Object.keys(obj);
    if (keys.length === 1) return normalizeAdvancedKind(keys[0]);
  }
  return "TimeLock";
}

function parseVaultNative(native: Record<string, unknown>): AdvancedVaultRecord {
  const kind = normalizeAdvancedKind(native.kind);
  return {
    vaultId: BigInt(String(native.vault_id ?? "0")),
    owner: String(native.owner ?? ""),
    token: String(native.token ?? ""),
    name: String(native.name ?? ""),
    balance: BigInt(String(native.balance ?? "0")),
    kind,
    withdrawn: Boolean(native.withdrawn ?? false),
    createdTimestamp: Number(native.created_timestamp ?? 0),
    unlockTimestamp: Number(native.unlock_timestamp ?? 0),
    withdrawalInitiatedTimestamp: Number(native.withdrawal_initiated_timestamp ?? 0),
    coolingOffDurationSeconds: Number(native.cooling_off_duration_seconds ?? 0),
    totalLockedAmount: BigInt(String(native.total_locked_amount ?? "0")),
    vestingStartTimestamp: Number(native.vesting_start_timestamp ?? 0),
    vestingEndTimestamp: Number(native.vesting_end_timestamp ?? 0),
    withdrawnSoFar: BigInt(String(native.withdrawn_so_far ?? "0")),
    backupAddress: native.backup_address ? String(native.backup_address) : null,
    inactivityPeriodSeconds: Number(native.inactivity_period_seconds ?? 0),
    lastPingTimestamp: Number(native.last_ping_timestamp ?? 0),
    claimedByBackup: Boolean(native.claimed_by_backup ?? false),
    isBeneficiary: false, // set by caller via listAdvancedVaults
  };
}

export async function getAdvancedVault(
  sourcePublicKey: string,
  vaultId: bigint,
): Promise<AdvancedVaultRecord | null> {
  try {
    if (!isAdvancedContractReachable()) return null;
    const srv = server();
    const source = await srv.getAccount(sourcePublicKey);
    const contract = new Contract(contractId());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call("get_vault", nativeToScVal(vaultId, { type: "u64" })))
      .setTimeout(60)
      .build();
    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) return null;
    const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!rv) return null;
    const native = scValToNative(rv) as Record<string, unknown> | null;
    if (!native || typeof native !== "object") return null;
    return parseVaultNative(native);
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] getAdvancedVault failed", vaultId, e);
    return null;
  }
}

export async function listAdvancedOwned(ownerPublicKey: string): Promise<bigint[]> {
  try {
    if (!isAdvancedContractReachable()) return [];
    const srv = server();
    const source = await srv.getAccount(ownerPublicKey);
    const contract = new Contract(contractId());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call("list_owned", new Address(ownerPublicKey).toScVal()))
      .setTimeout(60)
      .build();
    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) return [];
    const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!rv) return [];
    const native = scValToNative(rv);
    if (!Array.isArray(native)) return [];
    return native.map((v) => BigInt(String(v)));
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] listAdvancedOwned failed", e);
    return [];
  }
}

/** Beneficiary vaults are found from Horizon memos, not a backend. */
async function fetchBeneficiaryVaultsFromBackend(
  _beneficiaryPublicKey: string,
): Promise<AdvancedVaultRecord[]> {
  void _beneficiaryPublicKey;
  return [];
}

/**
 * List every Advanced vault (Time Gate / Unlock Intervals / Dead Man's Switch)
 * owned by `ownerPublicKey`, sorted newest-first. When
 * `beneficiaryPublicKey` is provided, also merges vaults discovered via
 * Stellar memo notifications (STL:VAULT:<id>) where that key is the
 * backup_address. Also merges HTLC vaults from the dedicated HTLC contract
 * (sender + recipient indexes). TimeLock vaults created via the standard
 * `create_vault` path on mav_v2 are excluded.
 */
export async function listAdvancedVaults(
  ownerPublicKey: string,
  beneficiaryPublicKey?: string,
): Promise<AdvancedVaultRecord[]> {
  try {
    const ids = await listAdvancedOwned(ownerPublicKey);
    let owned: AdvancedVaultRecord[] = [];
    if (ids.length > 0) {
      const settled = await Promise.all(ids.map((id) => getAdvancedVault(ownerPublicKey, id)));
      owned = settled.filter(
        (v): v is AdvancedVaultRecord => v !== null && v.kind !== "TimeLock",
      );
    }

    let beneficiary: AdvancedVaultRecord[] = [];
    const scanKey = beneficiaryPublicKey || ownerPublicKey;
    try {
      const { discoverVaultsFromMemos, discoveredDmsAsAdvanced } = await import(
        "@/src/vault/memo-discovery"
      );
      const discovered = await discoverVaultsFromMemos(scanKey);
      beneficiary = discoveredDmsAsAdvanced(discovered);
    } catch (e) {
      if (__DEV__) console.warn("[advanced-vaults] memo discovery failed", e);
      // Legacy fallback if a backend mirror still exists.
      if (beneficiaryPublicKey) {
        beneficiary = await fetchBeneficiaryVaultsFromBackend(beneficiaryPublicKey);
      }
    }

    let htlcRows: AdvancedVaultRecord[] = [];
    try {
      htlcRows = await listHtlcVaultsAsAdvanced(ownerPublicKey);
    } catch (e) {
      if (__DEV__) console.warn("[advanced-vaults] listHtlcVaults failed", e);
    }

    // Kind-prefixed keys — HTLC and mav_v2 both use independent u64 id spaces.
    const byId = new Map<string, AdvancedVaultRecord>();
    for (const v of owned) {
      byId.set(`${v.kind}:${v.vaultId.toString()}`, v);
    }
    for (const v of beneficiary) {
      const key = `${v.kind}:${v.vaultId.toString()}`;
      if (!byId.has(key)) {
        byId.set(key, v);
      }
    }
    for (const v of htlcRows) {
      byId.set(`${v.kind}:${v.vaultId.toString()}`, v);
    }

    const rows = Array.from(byId.values());
    rows.sort((a, b) => {
      if (a.createdTimestamp !== b.createdTimestamp) {
        return b.createdTimestamp - a.createdTimestamp;
      }
      return a.vaultId < b.vaultId ? 1 : -1;
    });
    return rows;
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] listAdvancedVaults failed", e);
    return [];
  }
}

/** Read-only currently-claimable (unlocked, not-yet-withdrawn) amount. */
export async function getUnlockedAmount(
  sourcePublicKey: string,
  vaultId: bigint,
): Promise<bigint | null> {
  try {
    if (!isAdvancedContractReachable()) return null;
    const srv = server();
    const source = await srv.getAccount(sourcePublicKey);
    const contract = new Contract(contractId());
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        contract.call("get_unlocked_amount", nativeToScVal(vaultId, { type: "u64" })),
      )
      .setTimeout(60)
      .build();
    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) return null;
    const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!rv) return null;
    const native = scValToNative(rv);
    return typeof native === "bigint" ? native : BigInt(String(native));
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] getUnlockedAmount failed", vaultId, e);
    return null;
  }
}

// Unlock-intervals metadata is stored in AsyncStorage keyed by vault ID
// so the discrete unlock schedule survives app restarts without an on-chain schema change.
export type VestingInterval = "daily" | "weekly" | "monthly";

export const VESTING_INTERVAL_SECONDS: Record<VestingInterval, number> = {
  daily: 86_400,
  weekly: 604_800,
  monthly: 2_592_000,
};

export interface VestingMeta {
  interval: VestingInterval;
}

const VESTING_META_PREFIX = "vesting_meta_";

export async function saveVestingMeta(vaultId: bigint, meta: VestingMeta): Promise<void> {
  const { storage } = await import("@/src/utils/storage");
  await storage.setItem(`${VESTING_META_PREFIX}${vaultId}`, JSON.stringify(meta));
}

export async function loadVestingMeta(vaultId: bigint): Promise<VestingMeta | null> {
  const { storage } = await import("@/src/utils/storage");
  const raw = await storage.getItem(`${VESTING_META_PREFIX}${vaultId}`, null);
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as VestingMeta;
  } catch {
    return null;
  }
}

/** Client-side unlock-intervals computation. When `intervalSeconds` is provided,
 * funds unlock in discrete steps (e.g. 1 XLM/day) instead of
 * continuous pro-rata. The on-chain contract still uses linear vesting,
 * but discrete amounts are always ≤ linear, so withdrawals always
 * succeed. */
export function computeVestedClaimable(
  v: AdvancedVaultRecord,
  nowSec: number = Math.floor(Date.now() / 1000),
  intervalSeconds?: number,
): bigint {
  if (nowSec <= v.vestingStartTimestamp) return 0n;

  let vestedTotal: bigint;
  const duration = Math.max(1, v.vestingEndTimestamp - v.vestingStartTimestamp);

  if (nowSec >= v.vestingEndTimestamp) {
    vestedTotal = v.totalLockedAmount;
  } else if (intervalSeconds && intervalSeconds > 0) {
    const totalIntervals = Math.max(1, Math.floor(duration / intervalSeconds));
    const elapsed = nowSec - v.vestingStartTimestamp;
    const completedIntervals = Math.min(totalIntervals, Math.floor(elapsed / intervalSeconds));
    if (completedIntervals >= totalIntervals) {
      vestedTotal = v.totalLockedAmount;
    } else {
      const perInterval = v.totalLockedAmount / BigInt(totalIntervals);
      vestedTotal = perInterval * BigInt(completedIntervals);
    }
  } else {
    const elapsed = BigInt(nowSec - v.vestingStartTimestamp);
    vestedTotal = (v.totalLockedAmount * elapsed) / BigInt(duration);
  }

  const claimable = vestedTotal - v.withdrawnSoFar;
  if (claimable < 0n) return 0n;
  return claimable > v.balance ? v.balance : claimable;
}

/** Stroops (7-decimal) -> display float. */
export function stroopsToFloat(v: bigint): number {
  return Number(v) / 10_000_000;
}

/** Display float XLM amount -> stroops bigint. */
export function xlmToStroops(amount: number): bigint {
  return BigInt(Math.round(amount * 10_000_000));
}

export function isValidBackupAddress(address: string, ownerPublicKey: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(address)) return false;
  return address !== ownerPublicKey;
}

export interface CreateMultiSigInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  coSignerAddress: string;
  /** Amount in stroops (native XLM, 7 decimals). */
  amount: bigint;
  unlockTimestamp: number;
}

export interface MultiSigActionResult {
  ok: boolean;
  contractId?: string;
  txHash?: string;
  errorRaw?: string;
  error?: string;
}

/**
 * Deploy a new Dual-Approval vault contract instance and initialize it.
 *
 * Flow:
 * 1. Submit a `createCustomContract` operation to deploy a new instance
 *    from the pre-uploaded WASM hash.
 * 2. Submit a second transaction calling `initialize` on the new contract.
 *
 * The contract id is extracted from the successful create result.
 */
export async function createMultiSigVault(
  input: CreateMultiSigInput,
): Promise<MultiSigActionResult> {
  const blocked = xlmLockMinimumError(input.amount, input.ownerPublicKey);
  if (blocked) return { ok: false, error: blocked, errorRaw: blocked };
  try {
    const dep = deployment();
    const srv = server();
    const source = await srv.getAccount(input.ownerPublicKey);
    const wasmHashHex = getDualApprovalWasmHash();
    const wasmHashBytes = Buffer.from(wasmHashHex, "hex");

    // Step 1: deploy contract instance from uploaded WASM.
    const createTx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        Operation.createCustomContract({
          wasmHash: wasmHashBytes,
          address: Address.fromString(input.ownerPublicKey),
        }),
      )
      .setTimeout(180)
      .build();

    const createSim = await srv.simulateTransaction(createTx);
    if (StellarRpc.Api.isSimulationError(createSim)) {
      return {
        ok: false,
        errorRaw: createSim.error,
        error: humanizeAdvancedError(createSim.error),
      };
    }
    const createAssembled = assembleCappedSorobanTx(createTx, createSim);
    createAssembled.sign(keypairIfUnlocked(input.ownerSecretSeed));

    const createSendRes = await srv.sendTransaction(createAssembled);
    if (createSendRes.status === "ERROR") {
      const rawJson = JSON.stringify(createSendRes.errorResult ?? {});
      return { ok: false, errorRaw: rawJson, error: humanizeAdvancedError(rawJson) };
    }

    const createTxHash = createSendRes.hash;
    let contractId: string | null = null;

    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const got = await srv.getTransaction(createTxHash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        const success = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
        if (success.returnValue) {
          try {
            const native = scValToNative(success.returnValue);
            if (typeof native === "string") {
              contractId = native;
            } else if (native && typeof native === "object" && "contractId" in native) {
              contractId = native.contractId as string;
            }
          } catch {
            /* derive from source sequence below */
          }
        }
        // createCustomContract id = sha256(sourceAccount || sequenceNumber).
        if (!contractId) {
          const seq = source.sequenceNumber();
          const hash = require("crypto")
            .createHash("sha256")
            .update(Buffer.from(input.ownerPublicKey))
            .update(Buffer.from(seq))
            .digest();
          contractId = StrKey.encodeContract(hash);
        }
        break;
      }
      return {
        ok: false,
        errorRaw: `Create tx failed with status ${got.status}`,
        error: humanizeAdvancedError(`Create tx failed with status ${got.status}`),
        txHash: createTxHash,
      };
    }

    if (!contractId) {
      return {
        ok: false,
        errorRaw: "Could not determine new contract id from create transaction",
        error: humanizeAdvancedError("Could not determine new contract id"),
        txHash: createTxHash,
      };
    }

    const token = dep.nativeXlmSac;
    const initSource = await srv.getAccount(input.ownerPublicKey);
    const initContract = new Contract(contractId);

    const initTx = new TransactionBuilder(initSource, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(
        initContract.call(
          "initialize",
          new Address(input.ownerPublicKey).toScVal(),
          new Address(input.coSignerAddress).toScVal(),
          new Address(token).toScVal(),
          nativeToScVal(input.amount, { type: "i128" }),
          nativeToScVal(input.unlockTimestamp, { type: "u64" }),
        ),
      )
      .setTimeout(180)
      .build();

    const initSim = await srv.simulateTransaction(initTx);
    if (StellarRpc.Api.isSimulationError(initSim)) {
      return {
        ok: false,
        errorRaw: initSim.error,
        error: humanizeAdvancedError(initSim.error),
        contractId,
      };
    }
    const initAssembled = assembleCappedSorobanTx(initTx, initSim);
    initAssembled.sign(keypairIfUnlocked(input.ownerSecretSeed));

    const initSendRes = await srv.sendTransaction(initAssembled);
    if (initSendRes.status === "ERROR") {
      const rawJson = JSON.stringify(initSendRes.errorResult ?? {});
      return {
        ok: false,
        errorRaw: rawJson,
        error: humanizeAdvancedError(rawJson),
        contractId,
        txHash: initSendRes.hash,
      };
    }

    const initTxHash = initSendRes.hash;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const got = await srv.getTransaction(initTxHash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        return { ok: true, contractId, txHash: initTxHash };
      }
      return {
        ok: false,
        errorRaw: `Init tx failed with status ${got.status}`,
        error: humanizeAdvancedError(`Init tx failed with status ${got.status}`),
        contractId,
        txHash: initTxHash,
      };
    }

    return {
      ok: false,
      errorRaw: "poll timeout on initialize",
      error: humanizeAdvancedError("timed out waiting for confirmation"),
      contractId,
      txHash: initTxHash,
    };
  } catch (e) {
    const raw = stringifyRpcError(e);
    return { ok: false, errorRaw: raw, error: humanizeAdvancedError(raw) };
  }
}

export interface MultiSigActionInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  /** The contract id of the deployed Dual-Approval vault instance. */
  contractId: string;
}

export interface MultiSigRequestWithdrawalInput extends MultiSigActionInput {
  amount: bigint;
  destination: string;
}

/**
 * Owner requests a withdrawal. Creates a pending WithdrawalRequest that
 * the co-signer must approve before claim() can execute.
 */
export async function requestMultiSigWithdrawal(
  input: MultiSigRequestWithdrawalInput,
): Promise<AdvancedResult> {
  return submitInvocationOnContract(
    input.contractId,
    "request_withdrawal",
    [
      new Address(input.ownerPublicKey).toScVal(),
      nativeToScVal(input.amount, { type: "i128" }),
      new Address(input.destination).toScVal(),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

/**
 * Co-signer approves the pending withdrawal request.
 */
export async function approveMultiSigWithdrawal(
  input: MultiSigActionInput,
): Promise<AdvancedResult> {
  return submitInvocationOnContract(
    input.contractId,
    "approve_withdrawal",
    [new Address(input.ownerPublicKey).toScVal()],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

/**
 * Either party may cancel a pending withdrawal request.
 */
export async function cancelMultiSigWithdrawal(
  input: MultiSigActionInput,
): Promise<AdvancedResult> {
  return submitInvocationOnContract(
    input.contractId,
    "cancel_withdrawal",
    [new Address(input.ownerPublicKey).toScVal()],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

/**
 * After approval + optional time-lock expiry, anyone may claim the
 * withdrawal. Returns the amount claimed.
 */
export async function claimMultiSigWithdrawal(
  input: MultiSigActionInput,
): Promise<AdvancedResult> {
  return submitInvocationOnContract(
    input.contractId,
    "claim",
    [],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

/**
 * Deposit more XLM into the vault.
 */
export async function depositMultiSigVault(
  input: MultiSigActionInput & { amount: bigint },
): Promise<AdvancedResult> {
  return submitInvocationOnContract(
    input.contractId,
    "deposit",
    [
      new Address(input.ownerPublicKey).toScVal(),
      nativeToScVal(input.amount, { type: "i128" }),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

/**
 * Extend the unlock timestamp.
 */
export async function extendMultiSigLock(
  input: MultiSigActionInput & { additionalSeconds: number },
): Promise<AdvancedResult> {
  return submitInvocationOnContract(
    input.contractId,
    "extend_lock",
    [
      new Address(input.ownerPublicKey).toScVal(),
      nativeToScVal(input.additionalSeconds, { type: "u64" }),
    ],
    input.ownerPublicKey,
    input.ownerSecretSeed,
  );
}

/**
 * Read the vault state from a deployed Dual-Approval contract.
 */
export async function getMultiSigVault(
  sourcePublicKey: string,
  contractId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const srv = server();
    const source = await srv.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call("get_vault"))
      .setTimeout(60)
      .build();
    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) return null;
    const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!rv) return null;
    const native = scValToNative(rv) as Record<string, unknown> | null;
    if (!native || typeof native !== "object") return null;
    return native;
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] getMultiSigVault failed", contractId, e);
    return null;
  }
}

/**
 * Read the pending withdrawal request.
 */
export async function getMultiSigWithdrawalRequest(
  sourcePublicKey: string,
  contractId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const srv = server();
    const source = await srv.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call("get_withdrawal_request"))
      .setTimeout(60)
      .build();
    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) return null;
    const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
    if (!rv) return null;
    const native = scValToNative(rv) as Record<string, unknown> | null;
    if (!native || typeof native !== "object") return null;
    return native;
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] getMultiSigWithdrawalRequest failed", contractId, e);
    return null;
  }
}

async function submitInvocationOnContract(
  contractId: string,
  methodName: string,
  args: xdr.ScVal[],
  ownerPublicKey: string,
  ownerSecretSeed: string,
): Promise<AdvancedResult> {
  try {
    const srv = server();
    const source = await srv.getAccount(ownerPublicKey);
    const contract = new Contract(contractId);
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: networkPassphrase(),
    })
      .addOperation(contract.call(methodName, ...args))
      .setTimeout(180)
      .build();

    const sim = await srv.simulateTransaction(tx);
    if (StellarRpc.Api.isSimulationError(sim)) {
      return { ok: false, errorRaw: sim.error, error: humanizeAdvancedError(sim.error) };
    }
    const assembled = assembleCappedSorobanTx(tx, sim);
    assembled.sign(keypairIfUnlocked(ownerSecretSeed));

    const sendRes = await srv.sendTransaction(assembled);
    if (sendRes.status === "ERROR") {
      const rawJson = JSON.stringify(sendRes.errorResult ?? {});
      return { ok: false, errorRaw: rawJson, error: humanizeAdvancedError(rawJson) };
    }

    const txHash = sendRes.hash;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const got = await srv.getTransaction(txHash);
      if (got.status === "NOT_FOUND" || got.status === "PENDING") continue;
      if (got.status === "SUCCESS") {
        const success = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
        let returnVal: bigint | undefined;
        try {
          if (success.returnValue) {
            const native = scValToNative(success.returnValue);
            if (typeof native === "bigint") returnVal = native;
          }
        } catch {
          /* leave undefined */
        }
        return { ok: true, vaultId: returnVal, txHash };
      }
      return {
        ok: false,
        errorRaw: `Tx failed with status ${got.status}`,
        error: humanizeAdvancedError(`Tx failed with status ${got.status}`),
        txHash,
      };
    }
    return {
      ok: false,
      errorRaw: "poll timeout",
      error: humanizeAdvancedError("timed out waiting for confirmation"),
      txHash,
    };
  } catch (e) {
    const raw = stringifyRpcError(e);
    return { ok: false, errorRaw: raw, error: humanizeAdvancedError(raw) };
  }
}

// ---------------------------------------------------------------------------
// HTLC (Hash Time-Locked Contract) — dedicated shared contract (not mav_v2)
// ---------------------------------------------------------------------------
// Contract: getHtlcDeployment().contractId
// Entrypoints: create / claim / refund / get_vault / list_sender_vaults /
//              list_recipient_vaults

/** Lifecycle status for list + detail UI. */
export type HtlcLifecycleStatus =
  | "locked"
  | "claimable"
  | "expired"
  | "claimed"
  | "refunded";

export interface HtlcState {
  vaultId: bigint;
  /** Hex-encoded SHA-256 hash of the secret preimage. */
  hash: string;
  sender: string;
  recipient: string;
  amount: bigint;
  /** Unix seconds — after this, sender may refund. */
  timelock: number;
  claimed: boolean;
  refunded: boolean;
  createdAt: number;
  /**
   * Optional: when the preimage is known off-chain (counterparty revealed it),
   * the lock is claimable before expiry.
   */
  preimageRevealed?: boolean;
}

export interface CreateHtlcInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  /** Vault display name (off-chain meta — contract does not store names). */
  name: string;
  /** Amount in stroops. */
  amount: bigint;
  /** Counterparty who can claim with the preimage. */
  recipient: string;
  /**
   * Hex SHA-256 of the secret. If `secret` is also provided the client will
   * prefer hashing the secret once on-chain wiring exists.
   */
  hash: string;
  /** Optional cleartext secret (never sent on-chain — only used to derive hash). */
  secret?: string;
  /** Unix seconds deadline for claim; after this only refund is allowed. */
  timelock: number;
}

export interface HtlcActionResult {
  ok: boolean;
  vaultId?: bigint;
  hash?: string;
  txHash?: string;
  errorRaw?: string;
  error?: string;
}

export interface HtlcActionInput {
  ownerPublicKey: string;
  ownerSecretSeed: string;
  vaultId: bigint;
}

export interface ClaimHtlcInput extends HtlcActionInput {
  /** Cleartext preimage whose SHA-256 must match the vault hash. */
  preimage: string;
}

/** Contract error codes from `contracts/htlc/src/lib.rs`. */
const HTLC_ERROR_MESSAGES: Record<number, string> = {
  1: "HTLC contract was already initialized.",
  2: "HTLC contract is not initialized yet.",
  3: "Enter an amount greater than zero.",
  4: "The timelock deadline must be in the future.",
  5: "That HTLC vault could not be found.",
  6: "This HTLC has already been claimed or refunded.",
  7: "Only the recipient can claim this HTLC.",
  8: "Only the sender can refund this HTLC.",
  9: "The claim deadline has passed — only a refund is possible now.",
  10: "The timelock hasn't expired yet — refund isn't available.",
  11: "That secret doesn't match the HTLC hash.",
  12: "Sender and recipient must be different addresses.",
  13: "Locks need at least 10 XLM",
};

function humanizeHtlcError(raw: string): string {
  if (!raw) return "Something went wrong. Please try again.";
  if (raw.includes("not yet deployed") || raw.includes("HTLC contract not")) {
    return "HTLC contract not yet deployed";
  }
  const code = extractContractErrorCode(raw);
  if (code != null && HTLC_ERROR_MESSAGES[code]) {
    return HTLC_ERROR_MESSAGES[code];
  }
  return humanizeAdvancedError(raw);
}

function assertHtlcDeployed(): void {
  if (!isHtlcContractDeployed()) {
    throw new Error("HTLC contract not yet deployed");
  }
}

function htlcContractId(): string {
  return getHtlcDeployment().contractId;
}

function normalizeHexHash(hash: string): string {
  return hash.trim().toLowerCase().replace(/^0x/, "");
}

function hexHashToScVal(hashHex: string): xdr.ScVal {
  const hex = normalizeHexHash(hashHex);
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("Hash must be a 64-character hex SHA-256 digest.");
  }
  return nativeToScVal(Buffer.from(hex, "hex"));
}

function bytesToHex(value: unknown): string {
  if (typeof value === "string") {
    const s = value.replace(/^0x/, "");
    if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) {
    return Buffer.from(value as number[]).toString("hex");
  }
  return "";
}

function addressToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.toString === "function") {
      const s = String(obj.toString());
      if (s.startsWith("G") || s.startsWith("C")) return s;
    }
  }
  return String(value ?? "");
}

const HTLC_META_PREFIX = "htlc_meta_";

export interface HtlcMeta {
  name: string;
}

export async function saveHtlcMeta(vaultId: bigint, meta: HtlcMeta): Promise<void> {
  const { storage } = await import("@/src/utils/storage");
  await storage.setItem(`${HTLC_META_PREFIX}${vaultId}`, JSON.stringify(meta));
}

export async function loadHtlcMeta(vaultId: bigint): Promise<HtlcMeta | null> {
  const { storage } = await import("@/src/utils/storage");
  const raw = await storage.getItem(`${HTLC_META_PREFIX}${vaultId}`, null);
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as HtlcMeta;
  } catch {
    return null;
  }
}

/** Map on-chain / mirrored HTLC state → lifecycle label for lists. */
export function deriveHtlcLifecycleStatus(
  state: HtlcState,
  nowSec: number = Math.floor(Date.now() / 1000),
  opts?: { viewerIsRecipient?: boolean },
): HtlcLifecycleStatus {
  if (state.claimed) return "claimed";
  if (state.refunded) return "refunded";
  if (nowSec >= state.timelock) return "expired";
  if (state.preimageRevealed || opts?.viewerIsRecipient) return "claimable";
  return "locked";
}

/**
 * Best-effort lifecycle from an AdvancedVaultRecord of kind HTLC.
 */
export function deriveHtlcStatusFromAdvancedVault(
  v: AdvancedVaultRecord,
  nowSec: number = Math.floor(Date.now() / 1000),
): HtlcLifecycleStatus {
  if (v.htlcRefunded) return "refunded";
  if (v.htlcClaimed) return "claimed";
  if (v.withdrawn) return "claimed";
  if (v.unlockTimestamp > 0 && nowSec >= v.unlockTimestamp) return "expired";
  if (v.isBeneficiary) return "claimable";
  return "locked";
}

/** Map HTLC lifecycle → unified list status (locked / unlocked / withdrawn). */
export function htlcLifecycleToUnifiedStatus(
  life: HtlcLifecycleStatus,
): "locked" | "unlocked" | "withdrawn" {
  if (life === "claimed" || life === "refunded") return "withdrawn";
  if (life === "claimable" || life === "expired") return "unlocked";
  return "locked";
}

function parseHtlcNative(
  native: Record<string, unknown>,
  viewerPublicKey?: string,
): HtlcState {
  const vaultId = BigInt(String(native.id ?? native.vault_id ?? "0"));
  const sender = addressToString(native.sender);
  const recipient = addressToString(native.recipient);
  return {
    vaultId,
    hash: bytesToHex(native.hash),
    sender,
    recipient,
    amount: BigInt(String(native.amount ?? "0")),
    timelock: Number(native.deadline ?? native.timelock ?? 0),
    claimed: Boolean(native.claimed ?? false),
    refunded: Boolean(native.refunded ?? false),
    createdAt: Number(native.created_at ?? native.createdAt ?? 0),
  };
}

function htlcStateToAdvanced(
  state: HtlcState,
  viewerPublicKey: string,
  name?: string,
): AdvancedVaultRecord {
  const settled = state.claimed || state.refunded;
  const isRecipient =
    !!viewerPublicKey &&
    state.recipient.toUpperCase() === viewerPublicKey.toUpperCase();
  return {
    vaultId: state.vaultId,
    owner: state.sender,
    token: getHtlcDeployment().nativeXlmSac,
    name: name?.trim() || `HTLC #${state.vaultId.toString()}`,
    balance: settled ? 0n : state.amount,
    kind: "HTLC",
    withdrawn: settled,
    createdTimestamp: state.createdAt,
    unlockTimestamp: state.timelock,
    withdrawalInitiatedTimestamp: 0,
    coolingOffDurationSeconds: 0,
    totalLockedAmount: state.amount,
    vestingStartTimestamp: 0,
    vestingEndTimestamp: 0,
    withdrawnSoFar: settled ? state.amount : 0n,
    backupAddress: state.recipient,
    inactivityPeriodSeconds: 0,
    lastPingTimestamp: 0,
    claimedByBackup: false,
    isBeneficiary: isRecipient && state.sender.toUpperCase() !== viewerPublicKey.toUpperCase(),
    htlcHash: state.hash,
    htlcClaimed: state.claimed,
    htlcRefunded: state.refunded,
  };
}

async function simulateHtlcCall(
  sourcePublicKey: string,
  methodName: string,
  args: xdr.ScVal[],
): Promise<unknown | null> {
  if (!isHtlcContractDeployed()) return null;
  const srv = server();
  const source = await srv.getAccount(sourcePublicKey);
  const contract = new Contract(htlcContractId());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(contract.call(methodName, ...args))
    .setTimeout(60)
    .build();
  const sim = await srv.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(sim)) return null;
  const rv = (sim as StellarRpc.Api.SimulateTransactionSuccessResponse).result?.retval;
  if (!rv) return null;
  return scValToNative(rv);
}

/**
 * Create an HTLC lock on the deployed shared contract.
 * Invokes `create(sender, recipient, hash, deadline, amount) → vault_id`.
 */
export async function createHtlcVault(
  input: CreateHtlcInput,
): Promise<HtlcActionResult> {
  const blocked = xlmLockMinimumError(input.amount, input.ownerPublicKey);
  if (blocked) return { ok: false, error: blocked, errorRaw: blocked };
  try {
    assertHtlcDeployed();
    await ensureTestnetFunded(input.ownerPublicKey);

    let hashHex = normalizeHexHash(input.hash);
    if ((!hashHex || !/^[0-9a-f]{64}$/.test(hashHex)) && input.secret?.trim()) {
      // Prefer caller-provided hash (create-vault hashes via expo-crypto).
      // Fallback: Node/crypto polyfill when only the secret is supplied.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createHash } = require("crypto") as typeof import("crypto");
      hashHex = createHash("sha256").update(input.secret.trim(), "utf8").digest("hex");
    }
    if (!/^[0-9a-f]{64}$/.test(hashHex)) {
      return {
        ok: false,
        errorRaw: "invalid hash",
        error: "Hash must be a 64-character hex SHA-256 digest.",
      };
    }
    if (!StrKey.isValidEd25519PublicKey(input.recipient)) {
      return {
        ok: false,
        errorRaw: "invalid recipient",
        error: "Enter a valid counterparty Stellar address.",
      };
    }

    const result = await submitInvocationOnContract(
      htlcContractId(),
      "create",
      [
        new Address(input.ownerPublicKey).toScVal(),
        new Address(input.recipient).toScVal(),
        hexHashToScVal(hashHex),
        nativeToScVal(input.timelock, { type: "u64" }),
        nativeToScVal(input.amount, { type: "i128" }),
      ],
      input.ownerPublicKey,
      input.ownerSecretSeed,
    );

    if (!result.ok) {
      return {
        ok: false,
        errorRaw: result.errorRaw,
        error: humanizeHtlcError(result.errorRaw ?? result.error ?? ""),
        txHash: result.txHash,
      };
    }

    if (result.vaultId != null && input.name.trim()) {
      try {
        await saveHtlcMeta(result.vaultId, { name: input.name.trim() });
      } catch {
        /* best-effort display name */
      }
    }

    return {
      ok: true,
      vaultId: result.vaultId,
      hash: hashHex,
      txHash: result.txHash,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : stringifyRpcError(e);
    return {
      ok: false,
      errorRaw: raw,
      error: humanizeHtlcError(raw),
    };
  }
}

/**
 * Claim an HTLC by revealing the preimage (recipient auth).
 * Invokes `claim(vault_id, preimage)`.
 */
export async function claimHtlc(input: ClaimHtlcInput): Promise<HtlcActionResult> {
  try {
    assertHtlcDeployed();
    const preimage = input.preimage;
    if (!preimage) {
      return { ok: false, errorRaw: "empty preimage", error: "Enter the secret preimage." };
    }
    const preimageBytes = Buffer.from(preimage, "utf8");
    const result = await submitInvocationOnContract(
      htlcContractId(),
      "claim",
      [
        nativeToScVal(input.vaultId, { type: "u64" }),
        nativeToScVal(preimageBytes),
      ],
      input.ownerPublicKey,
      input.ownerSecretSeed,
    );
    if (!result.ok) {
      return {
        ok: false,
        vaultId: input.vaultId,
        errorRaw: result.errorRaw,
        error: humanizeHtlcError(result.errorRaw ?? result.error ?? ""),
        txHash: result.txHash,
      };
    }
    return { ok: true, vaultId: input.vaultId, txHash: result.txHash };
  } catch (e) {
    const raw = e instanceof Error ? e.message : stringifyRpcError(e);
    return { ok: false, vaultId: input.vaultId, errorRaw: raw, error: humanizeHtlcError(raw) };
  }
}

/**
 * Refund an expired HTLC (sender auth). Invokes `refund(vault_id)`.
 */
export async function refundHtlc(input: HtlcActionInput): Promise<HtlcActionResult> {
  try {
    assertHtlcDeployed();
    const result = await submitInvocationOnContract(
      htlcContractId(),
      "refund",
      [nativeToScVal(input.vaultId, { type: "u64" })],
      input.ownerPublicKey,
      input.ownerSecretSeed,
    );
    if (!result.ok) {
      return {
        ok: false,
        vaultId: input.vaultId,
        errorRaw: result.errorRaw,
        error: humanizeHtlcError(result.errorRaw ?? result.error ?? ""),
        txHash: result.txHash,
      };
    }
    return { ok: true, vaultId: input.vaultId, txHash: result.txHash };
  } catch (e) {
    const raw = e instanceof Error ? e.message : stringifyRpcError(e);
    return { ok: false, vaultId: input.vaultId, errorRaw: raw, error: humanizeHtlcError(raw) };
  }
}

/**
 * Read HTLC lock state by vault id. Invokes `get_vault(vault_id)`.
 */
export async function getHtlcState(
  sourcePublicKey: string,
  vaultId: bigint,
): Promise<HtlcState | null> {
  try {
    assertHtlcDeployed();
    const native = await simulateHtlcCall(sourcePublicKey, "get_vault", [
      nativeToScVal(vaultId, { type: "u64" }),
    ]);
    if (!native || typeof native !== "object") return null;
    return parseHtlcNative(native as Record<string, unknown>, sourcePublicKey);
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] getHtlcState failed", vaultId, e);
    return null;
  }
}

/** List vault IDs where `publicKey` is the sender. */
export async function listHtlcSenderVaultIds(
  publicKey: string,
): Promise<bigint[]> {
  try {
    const native = await simulateHtlcCall(publicKey, "list_sender_vaults", [
      new Address(publicKey).toScVal(),
    ]);
    if (!Array.isArray(native)) return [];
    return native.map((v) => BigInt(String(v)));
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] listHtlcSenderVaultIds failed", e);
    return [];
  }
}

/** List vault IDs where `publicKey` is the recipient. */
export async function listHtlcRecipientVaultIds(
  publicKey: string,
): Promise<bigint[]> {
  try {
    const native = await simulateHtlcCall(publicKey, "list_recipient_vaults", [
      new Address(publicKey).toScVal(),
    ]);
    if (!Array.isArray(native)) return [];
    return native.map((v) => BigInt(String(v)));
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] listHtlcRecipientVaultIds failed", e);
    return [];
  }
}

/**
 * Load all HTLC vaults for a wallet (as sender and/or recipient) and map
 * them into AdvancedVaultRecord rows for UnifiedVaultsList / dashboards.
 */
export async function listHtlcVaultsAsAdvanced(
  publicKey: string,
): Promise<AdvancedVaultRecord[]> {
  if (!isHtlcContractDeployed()) return [];
  try {
    const [senderIds, recipientIds] = await Promise.all([
      listHtlcSenderVaultIds(publicKey),
      listHtlcRecipientVaultIds(publicKey),
    ]);
    const idSet = new Set<string>();
    const ids: bigint[] = [];
    for (const id of [...senderIds, ...recipientIds]) {
      const key = id.toString();
      if (idSet.has(key)) continue;
      idSet.add(key);
      ids.push(id);
    }
    if (ids.length === 0) return [];

    const settled = await Promise.all(
      ids.map(async (id) => {
        const state = await getHtlcState(publicKey, id);
        if (!state) return null;
        const meta = await loadHtlcMeta(id).catch(() => null);
        return htlcStateToAdvanced(state, publicKey, meta?.name);
      }),
    );
    return settled.filter((v): v is AdvancedVaultRecord => v !== null);
  } catch (e) {
    if (__DEV__) console.warn("[advanced-vaults] listHtlcVaultsAsAdvanced failed", e);
    return [];
  }
}
