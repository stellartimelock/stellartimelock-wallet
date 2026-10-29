// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Stellar TimeLock LLC

// @CONTEXT: implements the four mutating IVaultClient methods against the deployed XlmVault contract. Pipeline: build envelope → simulateTransaction (auth entries, resource estimates, preflight return value) → assembleTransaction (adds auth+footprint+fee) → sign with the user's secret seed (kept in expo-secure-store, never sent to a backend) → sendTransaction → poll getTransaction until non-PENDING. Each phase has its own try/catch so failures throw a categorised SorobanError the UI can render targeted messaging for; successful writes emit a TxReceipt for the global explorer-link banner. Reads bypass signing via invokeRead() below.

// @CONTEXT: must load the Buffer polyfill before any stellar-sdk symbol resolves, since the SDK references Buffer at module load time
import "@/src/polyfills/buffer";

import {
  Account,
  Address,
  Contract,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  rpc as StellarRpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { assembleCappedSorobanTx, assertSorobanFeeWithinCap } from "@/src/wallet/soroban-fee-cap";
import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import { lockMinimumBlockReason } from "@/src/vault/lock-minimum";
import { getActiveDeployment, subscribeActiveNetwork } from "@/src/wallet/contract-config";
import {
  getCurrentRpcUrl,
  isRpcTransportError,
  rotateRpcUrl,
} from "@/src/wallet/rpc-failover";
import {
  loadCachedVaults,
  saveCachedVaults,
} from "@/src/api/vault-cache";
import { mergeVaults } from "@/src/api/vault-merge";
import type {
  CreateVaultInput,
  IVaultClient,
  Summary,
  Transaction as VaultTransaction,
  Vault,
} from "@/src/vault/contract";
import { loadSigningKeypair } from "@/src/wallet/stellar";
import {
  SorobanNetworkError,
  SorobanOnChainError,
  SorobanPollTimeoutError,
  SorobanSendError,
  SorobanSignError,
  SorobanSimulationError,
  WalletNotConnectedError,
} from "./soroban-errors";
import {
  emitReceipt,
  explorerForTx,
  type SorobanMethod,
  type TxReceipt,
} from "./tx-receipts";
import { storage } from "@/src/utils/storage";
import { wipeKeypair } from "@/src/security/secure-wipe";

const BASE_FEE = "10000"; // 0.001 XLM base; Soroban fees added by assembleTransaction.
const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 30; // → ~45s budget before declaring a poll timeout.

function rpcServer(): StellarRpc.Server {
  // @CONTEXT: resolves the URL on every call (Server construction is cheap) so rotations triggered by rpc-failover.ts are honored without rebuilding any caller's captured server instance
  return new StellarRpc.Server(getCurrentRpcUrl(), { allowHttp: false });
}

async function loadAccount(publicKey: string): Promise<Account> {
  // @CONTEXT: getAccount is the first network call in every write pipeline; if the active RPC is dropping mobile traffic the user sees an empty dashboard, so we retry across every fallback URL (safe since this is a pure read)
  const dep = getActiveDeployment();
  const total = 1 + (dep.rpcFallbacks?.length ?? 0);
  let lastErr: unknown;
  for (let attempt = 0; attempt < Math.max(1, total); attempt++) {
    try {
      const fetched = await rpcServer().getAccount(publicKey);
      return new Account(fetched.accountId(), fetched.sequenceNumber());
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface InvokeResult {
  returnValue: xdr.ScVal | undefined;
  receipt: TxReceipt;
}

async function invokeContract(args: {
  ownerPublicKey: string;
  method: SorobanMethod;
  params: xdr.ScVal[];
}): Promise<InvokeResult> {
  const { ownerPublicKey, method, params } = args;
  const server = rpcServer();

  let tx: Transaction;
  try {
    const source = await loadAccount(ownerPublicKey);
    const contract = new Contract(getActiveDeployment().contractId);
    tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: getActiveDeployment().networkPassphrase,
    })
      .addOperation(contract.call(method, ...params))
      .setTimeout(60)
      .build();
  } catch (e) {
    throw new SorobanNetworkError(method, "build", e);
  }

  let sim;
  try {
    sim = await server.simulateTransaction(tx);
  } catch (e) {
    throw new SorobanNetworkError(method, "simulate", e);
  }
  if (StellarRpc.Api.isSimulationError(sim)) {
    throw new SorobanSimulationError(method, sim.error);
  }

  let assembled: Transaction;
  try {
    assembled = assembleCappedSorobanTx(tx, sim);
  } catch (e) {
    // @CONTEXT: assembly failures are almost always a malformed sim response, so surface them as simulation errors to keep a single error category for the user
    throw new SorobanSimulationError(
      method,
      `Could not assemble simulated transaction: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // @CONTEXT: signer is used exactly once (single-shot invoke), so we wipe `_secretSeed`/`_secretKey` immediately after sign() so the SDK Keypair holds nothing sensitive by the time we hand the assembled tx off to sendTransaction()
  try {
    const kp = await loadSigningKeypair();
    if (!kp) throw new WalletNotConnectedError(method);
    const signer = keypairIfUnlocked(kp.secretSeed);
    try {
      assembled.sign(signer);
    } finally {
      wipeKeypair(signer);
    }
  } catch (e) {
    if (e instanceof WalletNotConnectedError) throw e;
    throw new SorobanSignError(method, e);
  }

  let sendRes: StellarRpc.Api.SendTransactionResponse;
  try {
    sendRes = await server.sendTransaction(assembled);
  } catch (e) {
    throw new SorobanNetworkError(method, "send", e);
  }
  if (sendRes.status === "ERROR" || sendRes.status === "DUPLICATE") {
    const detail =
      (sendRes.status === "ERROR" && sendRes.errorResult?.result().switch().name) ||
      sendRes.status;
    throw new SorobanSendError(method, String(detail), sendRes.hash);
  }

  const txHash = sendRes.hash;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    let got;
    try {
      got = await server.getTransaction(txHash);
    } catch {
      // @CONTEXT: transient network blips during polling shouldn't abort the operation since the tx is already submitted — keep polling
      continue;
    }
    if (got.status === "NOT_FOUND") continue;
    if (got.status === "SUCCESS") {
      const success = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
      const receipt: TxReceipt = {
        method,
        txHash,
        ledger: typeof success.ledger === "number" ? success.ledger : undefined,
        explorerUrl: explorerForTx(txHash),
        status: "success",
        emittedAt: Date.now(),
      };
      emitReceipt(receipt);
      return { returnValue: success.returnValue ?? undefined, receipt };
    }
    if (got.status === "FAILED") {
      emitReceipt({
        method,
        txHash,
        explorerUrl: explorerForTx(txHash),
        status: "failed",
        emittedAt: Date.now(),
      });
      throw new SorobanOnChainError(method, txHash);
    }
  }
  // @CONTEXT: poll budget exhausted — emit a PENDING receipt so the global banner can offer a "Recheck" affordance; the tx might still finalize
  emitReceipt({
    method,
    txHash,
    explorerUrl: explorerForTx(txHash),
    status: "pending",
    emittedAt: Date.now(),
  });
  throw new SorobanPollTimeoutError(method, txHash);
}

function scAddress(g: string): xdr.ScVal {
  return new Address(g).toScVal();
}
function scU64(v: number | bigint): xdr.ScVal {
  return nativeToScVal(typeof v === "number" ? BigInt(v) : v, { type: "u64" });
}
function scI128(v: number | bigint): xdr.ScVal {
  return nativeToScVal(typeof v === "number" ? BigInt(v) : v, { type: "i128" });
}
function scString(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "string" });
}

// XLM contract balances are i128 in 7-decimal "stroop" units (10⁷ per XLM).
const STROOPS_PER_XLM = 10_000_000n;
function xlmToStroops(amount: number): bigint {
  // Round-half-up to avoid silent truncation of user-entered amounts.
  return BigInt(Math.round(amount * Number(STROOPS_PER_XLM)));
}
function stroopsToXlm(stroops: bigint | number): number {
  const n = typeof stroops === "bigint" ? Number(stroops) : stroops;
  return n / Number(STROOPS_PER_XLM);
}

// @CONTEXT: mirrors `pub struct Vault` in contracts/xlm_vault/src/lib.rs
interface ContractVault {
  vault_id: bigint;
  owner: string;
  name: string;
  balance: bigint;
  unlock_timestamp: bigint;
  created_timestamp: bigint;
  withdrawn: boolean;
}

function decodeVault(sv: xdr.ScVal): ContractVault {
  const obj = scValToNative(sv) as Record<string, unknown>;
  return {
    vault_id: BigInt(obj.vault_id as string | number | bigint),
    owner: String(obj.owner),
    name: String(obj.name),
    balance: BigInt(obj.balance as string | number | bigint),
    unlock_timestamp: BigInt(obj.unlock_timestamp as string | number | bigint),
    created_timestamp: BigInt(obj.created_timestamp as string | number | bigint),
    withdrawn: Boolean(obj.withdrawn),
  };
}

function statusFor(v: ContractVault, nowSec: number): Vault["status"] {
  if (v.withdrawn) return "withdrawn";
  return nowSec >= Number(v.unlock_timestamp) ? "unlocked" : "locked";
}

function toVault(c: ContractVault, off: Partial<Vault> = {}): Vault {
  return {
    vault_id: c.vault_id.toString(),
    owner_public_key: c.owner,
    name: c.name,
    description: off.description ?? "",
    template: off.template ?? "custom",
    balance: stroopsToXlm(c.balance),
    target_amount: off.target_amount ?? null,
    unlock_timestamp: Number(c.unlock_timestamp),
    created_timestamp: Number(c.created_timestamp),
    status: statusFor(c, Math.floor(Date.now() / 1000)),
  };
}

// @CONTEXT: the Soroban Vault struct stores only the financial fields, but the mobile UI also renders description/template/target_amount which live off-contract, so this metadata is persisted in two tiers — Tier 1 device AsyncStorage for instant local reads, and Tier 2 backend `vault_meta` collection as a cross-device mirror (so a second device with the same seed shows real names instead of "Vault #N"). Writes go to Tier 1 synchronously then Tier 2 best-effort in the background; reads prefer Tier 1, with listVaults bulk-hydrating any IDs missing locally from Tier 2.

const META_PREFIX = "xlm_vault_soroban_meta:";

interface VaultMeta {
  description: string;
  template: string;
  target_amount: number | null;
  name?: string;
  withdrawal_destination?: string;
  withdrawal_destination_label?: string;
  // @CONTEXT: memo saved alongside the withdrawal destination, set when the vault was created against an address book entry with a deposit memo, so the send-flow can pre-fill it without a re-look-up after a long time-lock
  withdrawal_memo?: string;
  /** ID of the local Bill that spawned this vault. */
  bill_id?: string;
  // @CONTEXT: post-unlock routing kind — "send" offers a one-tap Send handoff prefilled with withdrawal_destination + memo; "swap" offers a one-tap Swap handoff prefilled with withdrawal_swap_ticker as the target currency and the vault balance as the source amount; undefined (legacy rows / no choice) renders no post-unlock CTA
  withdrawal_kind?: "send" | "swap";
  // @CONTEXT: lowercase SimpleSwap ticker used to pre-select the target currency in the Swap wizard, only meaningful when withdrawal_kind === "swap"
  withdrawal_swap_ticker?: string;
}

const EMPTY_META: VaultMeta = {
  description: "",
  template: "custom",
  target_amount: null,
  name: undefined,
};

async function loadMeta(owner: string, vaultId: string): Promise<VaultMeta> {
  const m = await storage.getItem<VaultMeta>(
    `${META_PREFIX}${owner}:${vaultId}`,
    EMPTY_META,
  );
  return m ?? EMPTY_META;
}

async function saveMetaLocal(
  owner: string,
  vaultId: string,
  meta: VaultMeta,
): Promise<void> {
  await storage.setItem(`${META_PREFIX}${owner}:${vaultId}`, meta);
}

async function saveMeta(
  owner: string,
  vaultId: string,
  meta: VaultMeta,
): Promise<void> {
  await saveMetaLocal(owner, vaultId, meta);
}

interface RemoteMeta {
  owner_public_key: string;
  vault_id: string;
  contract_id: string;
  description: string;
  template: string;
  target_amount: number | null;
  name?: string | null;
  withdrawal_destination?: string | null;
  withdrawal_destination_label?: string | null;
  withdrawal_memo?: string | null;
  bill_id?: string | null;
  withdrawal_kind?: string | null;
  withdrawal_swap_ticker?: string | null;
  // @CONTEXT: last-known values written by the frontend after a successful read; used as the source of truth when the live RPC read returns zeroed/uninitialized state (typical after a Hermes XDR decode failure + events aging out of retention). All fields optional so legacy records pre-dating the snapshot schema still validate.
  balance_xlm?: number | null;
  unlock_timestamp?: number | null;
  snapshot_ledger?: number | null;
  snapshot_at?: string | null;
  on_chain_status?: string | null;
  // @CONTEXT: created_at is the first-upsert anchor the History tab uses to synthesize a "Vault Created" event for archived vaults whose on-chain create event has aged out of RPC retention; updated_at is the last-edit timestamp
  created_at?: string | null;
  updated_at?: string | null;
}

// @CONTEXT: writes the latest on-chain snapshot for a vault back to MongoDB — when Hermes XDR decoding fails on simulateTransaction AND the event retention window has aged out, this backend snapshot from a prior successful read is the only place left with the vault's REAL balance/unlock_timestamp, so without it the dashboard falls through to events-derived stubs like "Vault #N · 1970-01-01 · 0 XLM". Fire-and-forget PATCH (never blocks a render, never nulls out fields the caller didn't include); skipped in REST/testnet mode and for archived-status vaults (no real values to snapshot there).
// @CONTEXT: session-scoped registry of vault keys already pushed a terminal `withdrawn` snapshot for, so repeated PATCH calls are short-circuited — a withdrawn vault's on-chain state is permanently terminal, so re-pushing the same payload every listVaults() refresh just spins backend writes for no gain. Intentionally not persisted to disk since a fresh boot benefits from one final write per terminal vault.
const _frozenSnapshots = new Set<string>();

async function pushSnapshotToBackend(
  owner: string,
  vaultId: string,
  snap: {
    balance_xlm?: number;
    unlock_timestamp?: number;
    snapshot_ledger?: number;
    on_chain_status?: "live" | "archived" | "withdrawn" | "unknown";
  },
): Promise<void> {
  return;
  const frozenKey = `${owner}::${vaultId}`;
  if (snap.on_chain_status === "withdrawn") {
    if (_frozenSnapshots.has(frozenKey)) return;
    _frozenSnapshots.add(frozenKey);
  }
  try {
    await fetch(
      `${""}/api/vault-meta/${owner}/${vaultId}/snapshot`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: getActiveDeployment().contractId,
          ...snap,
        }),
      },
    );
  } catch {
    // Snapshot write is best-effort.
  }
}

// @CONTEXT: pulls every Tier-2 record for `owner` and writes any not already cached locally into Tier 1; called once per listVaults to keep things lazy — no background sync workers, no startup roundtrips
async function hydrateMetaFromBackend(owner: string): Promise<void> {
  await hydrateMetaImpl(owner, { force: false });
}

// @CONTEXT: explicit user-initiated sync — pulls every Tier-2 record and overwrites locally cached meta; used by the dashboard's pull-to-refresh when the user knows they want backend names (e.g. fresh device). Returns the number of meta records updated.
export async function forceSyncMetaFromBackend(owner: string): Promise<number> {
  return hydrateMetaImpl(owner, { force: true });
}

// @CONTEXT: a stuck vault is one whose backend meta still reads on_chain_status "live" (or undefined) but whose on-chain state is already withdrawn or TTL-pruned, causing the withdraw button to fail with nothing to withdraw. This flips the meta to "withdrawn" and zeroes the last-known balance via the existing snapshot PATCH endpoint (no new backend surface). Fire-and-forget; called from buildArchivedOverlayFromMetas (stale-live cross-check), the user-triggered "Dismiss vault" action, and auto-heal on withdraw failure.
/**
 * Update vault labels stored on this phone. On-chain contract terms
 * are unchanged. Names and withdrawal details stay in local storage.
 */
export async function putVaultMeta(
  owner: string,
  vaultId: string,
  fields: {
    name?: string;
    backup_address?: string | null;
    description?: string;
    template?: string;
    target_amount?: number | null;
    withdrawal_destination?: string | null;
    withdrawal_destination_label?: string | null;
    withdrawal_memo?: string | null;
    bill_id?: string | null;
    withdrawal_kind?: "send" | "swap" | null;
    withdrawal_swap_ticker?: string | null;
  },
): Promise<boolean> {
  try {
    const existing = await loadMeta(owner, vaultId);
    const updated: VaultMeta = {
      ...existing,
      ...(fields.name !== undefined ? { name: fields.name ?? undefined } : {}),
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.template !== undefined ? { template: fields.template } : {}),
      ...(fields.target_amount !== undefined ? { target_amount: fields.target_amount } : {}),
      ...(fields.withdrawal_destination !== undefined
        ? { withdrawal_destination: fields.withdrawal_destination ?? undefined }
        : {}),
      ...(fields.withdrawal_destination_label !== undefined
        ? { withdrawal_destination_label: fields.withdrawal_destination_label ?? undefined }
        : {}),
      ...(fields.withdrawal_memo !== undefined
        ? { withdrawal_memo: fields.withdrawal_memo ?? undefined }
        : {}),
      ...(fields.bill_id !== undefined ? { bill_id: fields.bill_id ?? undefined } : {}),
      ...(fields.withdrawal_kind !== undefined
        ? { withdrawal_kind: fields.withdrawal_kind ?? undefined }
        : {}),
      ...(fields.withdrawal_swap_ticker !== undefined
        ? { withdrawal_swap_ticker: fields.withdrawal_swap_ticker ?? undefined }
        : {}),
    };
    await saveMetaLocal(owner, vaultId, updated);
    return true;
  } catch {
    return false;
  }
}

export async function dismissVaultMeta(
  owner: string,
  vaultId: string,
): Promise<boolean> {
  return true;
  try {
    const res = await fetch(
      `${""}/api/vault-meta/${owner}/${vaultId}/snapshot`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: getActiveDeployment().contractId,
          on_chain_status: "withdrawn",
          balance_xlm: 0,
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function hydrateMetaImpl(
  owner: string,
  opts: { force: boolean },
): Promise<number> {
  return 0;
  let updated = 0;
  try {
    const url = `${""}/api/vault-meta/${owner}?contract_id=${encodeURIComponent(
      getActiveDeployment().contractId,
    )}&active_only=true`;
    const res = await fetch(url);
    if (!res.ok) return 0;
    const remotes = (await res.json()) as RemoteMeta[];
    console.info(
      `[sync-filter] hydrateMetaImpl(${owner.slice(0, 6)}…, force=${opts.force}) → ${remotes.length} active meta row(s). Archived + withdrawn excluded server-side.`,
    );
    await Promise.all(
      remotes.map(async (r) => {
        const local = await storage.getItem<VaultMeta>(
          `${META_PREFIX}${owner}:${r.vault_id}`,
          EMPTY_META,
        );
        const isMissing =
          !local ||
          (local.description === "" &&
            local.template === "custom" &&
            local.target_amount === null);
        if (opts.force || isMissing) {
          await saveMetaLocal(owner, r.vault_id, {
            description: r.description,
            template: r.template,
            target_amount: r.target_amount,
            name: r.name ?? undefined,
            withdrawal_destination: r.withdrawal_destination ?? undefined,
            withdrawal_destination_label:
              r.withdrawal_destination_label ?? undefined,
            withdrawal_memo: r.withdrawal_memo ?? undefined,
            bill_id: r.bill_id ?? undefined,
            withdrawal_kind:
              r.withdrawal_kind === "send" || r.withdrawal_kind === "swap"
                ? r.withdrawal_kind
                : undefined,
            withdrawal_swap_ticker: r.withdrawal_swap_ticker ?? undefined,
          });
          updated += 1;
        }
      }),
    );
  } catch {
    // Hydration is best-effort — listVaults will still render with stub
    // meta if the backend is unreachable.
  }
  return updated;
}

// @CONTEXT: Soroban persistent storage entries have a TTL (~30 days by default) after which they move to "archived" state; simulateTransaction(get_vault) then returns entry-not-live and the events stream may have also aged out of RPC retention, even though the vault is still real on-chain (preserved across snapshots, just invisible until a RestoreFootprint op runs). To keep older vaults from silently dropping off the dashboard, this fetches the off-chain backend meta records and surfaces any vault_id the backend knows about but that's missing from the current live read as a synthetic Vault with status "archived", with a "Wake Up" CTA that calls wakeUpVault. On-chain balance/unlock_timestamp/created_timestamp aren't recoverable from the meta side-store, so they're surfaced as 0/unknown; if the device cache is cleared and the backend mirror is empty the vault is only recoverable via a Soroban-aware tool (stellar-cli, explorer with RestoreFootprint). Only attempted when running against Soroban, so REST/testnet mode is unaffected.
// @CONTEXT: for each archived row emitted, the backend snapshot is honoured where present (balance_xlm, unlock_timestamp, created_at) so archived cards can show "last known: X XLM"; without a snapshot the card falls back to "ledger entry pruned by TTL" copy
function buildArchivedOverlayFromMetas(
  owner: string,
  remotes: RemoteMeta[],
  liveIds: Set<string>,
): Vault[] {
  const out: Vault[] = [];
  for (const r of remotes) {
    if (liveIds.has(r.vault_id)) continue;
    const createdTs = parseIsoToUnix(r.created_at ?? r.updated_at ?? null);
    // @CONTEXT: `withdrawn` renders as a withdrawn card even though live RPC reads can't see it (create event aged out after withdrawal, shouldn't downgrade to archived+WakeUp); `live` with a real snapshot renders locked/unlocked by current time; anything else falls back to archived for synthetic stubs and pruned entries
    let status: Vault["status"] = "archived";
    if (r.on_chain_status === "withdrawn") {
      status = "withdrawn";
    } else if (
      r.on_chain_status === "live" &&
      (r.unlock_timestamp ?? 0) > 0
    ) {
      const nowSec = Math.floor(Date.now() / 1000);
      status = nowSec >= (r.unlock_timestamp ?? 0) ? "unlocked" : "locked";
    }

    // @CONTEXT: a meta saying `on_chain_status: "live"` while being synthesised as an OVERLAY row (not in liveIds) is the stuck-vault signature — the on-chain entry no longer exists (TTL-pruned or withdrawn) but the meta still says live, so this flips the meta to withdrawn server-side (fire-and-forget) and coerces the in-memory status + balance so the current render is already correct
    let balance = r.balance_xlm ?? 0;
    if (r.on_chain_status === "live") {
      console.info(
        `[sync-auto-heal] Vault ${r.vault_id} meta says live but is not ` +
          `in the on-chain live set — coercing to withdrawn.`,
      );
      status = "withdrawn";
      balance = 0;
      void dismissVaultMeta(owner, r.vault_id);
    }

    out.push({
      vault_id: r.vault_id,
      owner_public_key: owner,
      name: r.name?.trim() ? r.name : `Vault #${r.vault_id}`,
      description: r.description ?? "",
      template: r.template ?? "custom",
      balance,
      target_amount: r.target_amount ?? null,
      unlock_timestamp: r.unlock_timestamp ?? 0,
      created_timestamp: createdTs,
      status,
    });
  }
  return out;
}

// @CONTEXT: returns 0 on any parse failure so callers don't have to branch — 0 sorts to the bottom of the History tab, the desired behavior for an unknown timestamp
function parseIsoToUnix(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  return Math.floor(ms / 1000);
}

// @CONTEXT: public Soroban RPCs only retain getEvents history for ~7 days or less, so vaults created before that window have no live "create" event to render; this emits a synthetic VaultTransaction (kind "create", sentinel non-hex tx_id `meta:{vault_id}` so Horizon lookups don't get confused, timestamp from the meta's created_at) for every backend meta record missing a live create row. Trade-offs: the original initial_deposit amount can't be recovered so amount is set to 0, and the reconstructed unlock_timestamp isn't available either — the note field calls out that the row is reconstructed, not raw.
async function fetchArchivedCreateEvents(
  owner: string,
  liveEvents: ParsedEvent[],
): Promise<ParsedEvent[]> {
  return [];
  // Determine which vault_ids already have a live "create" row — those
  // are NOT archived from a History POV and shouldn't get a synth row.
  const liveCreatedIds = new Set(
    liveEvents.filter((e) => e.kind === "create").map((e) => e.vault_id),
  );
  try {
    const url = `${""}/api/vault-meta/${owner}?contract_id=${encodeURIComponent(
      getActiveDeployment().contractId,
    )}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const remotes = (await res.json()) as RemoteMeta[];
    const out: ParsedEvent[] = [];
    for (const r of remotes) {
      if (liveCreatedIds.has(r.vault_id)) continue;
      const ts = parseIsoToUnix(r.created_at ?? r.updated_at ?? null);
      out.push({
        // Sentinel id so FlatList keyExtractor stays unique and Horizon
        // lookups (if any future code wires them) skip non-hex tx_ids.
        tx_id: `meta:${r.vault_id}`,
        vault_id: r.vault_id,
        owner_public_key: owner,
        kind: "create",
        amount: 0,
        note:
          r.name?.trim()
            ? `${r.name} · reconstructed from backend metadata`
            : "Reconstructed from backend metadata (on-chain event archived)",
        timestamp: ts,
        created_at: r.created_at ?? r.updated_at ?? new Date(0).toISOString(),
      });
    }
    return out;
  } catch {
    // History reconstruction is best-effort. Backend unreachable just
    // means the History tab shows whatever live events we got — same as
    // before this feature shipped.
    return [];
  }
}

// Known-funded source accounts used purely as the "source" of read-only
// simulations. simulateTransaction does not actually submit, but it does
// require the source account to exist on-chain so the RPC can resolve its
// sequence number. We use one well-known funded account per network.
//
// - Testnet: the contract deployer (also friendbot-funded).
// - Mainnet: a well-known funded mainnet account (SDF-adjacent, active
//   since 2018, >1000 XLM balance verified). The previous constant here
//   had an invalid strkey checksum (a typo in the address) — every
//   `invokeRead` on mainnet threw "invalid checksum" the moment the SDK
//   tried to decode it into an Address, tripping SorobanNetworkError
//   before the RPC was even contacted. This is the root cause of the
//   "listVaults throws invalid checksum" symptom that was masking the
//   "No vaults yet" empty-state for wallets that have never created a
//   vault. If you'd prefer to point at a different funded mainnet
//   account, change this constant — it is never signed for.
const READ_SIM_SOURCE: Record<"testnet" | "mainnet", string> = {
  testnet: "GAEPPLTQ4OIBG4J6DSI33FDYBB7YCKWOT36DNVLNOV65PIVSBAVSGXLS",
  mainnet: "GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S",
};

async function invokeRead(method: string, params: xdr.ScVal[]): Promise<xdr.ScVal> {
  let source: Account;
  const dep = getActiveDeployment();
  const simSourcePk = READ_SIM_SOURCE[dep.network];
  try {
    source = await loadAccount(simSourcePk);
  } catch (e) {
    throw new SorobanNetworkError(method, "build", e);
  }
  const contract = new Contract(dep.contractId);
  let tx: Transaction;
  try {
    tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: dep.networkPassphrase,
    })
      .addOperation(contract.call(method, ...params))
      .setTimeout(60)
      .build();
  } catch (e) {
    throw new SorobanNetworkError(method, "build", e);
  }
  // Simulate with RPC failover. simulateTransaction is a pure read
  // (no submission, no fee), so retrying across providers is safe.
  let sim;
  const total = 1 + (dep.rpcFallbacks?.length ?? 0);
  let lastErr: unknown;
  for (let attempt = 0; attempt < Math.max(1, total); attempt++) {
    try {
      sim = await rpcServer().simulateTransaction(tx);
      break;
    } catch (e) {
      lastErr = e;
      if (!isRpcTransportError(e) || attempt === total - 1) {
        throw new SorobanNetworkError(method, "simulate", e);
      }
      rotateRpcUrl(e);
    }
  }
  if (!sim) {
    throw new SorobanNetworkError(method, "simulate", lastErr);
  }
  if (StellarRpc.Api.isSimulationError(sim)) {
    throw new SorobanSimulationError(method, sim.error);
  }
  if (!sim.result) {
    throw new SorobanSimulationError(method, "Empty simulation result");
  }
  return sim.result.retval;
}

// @CONTEXT: powers the History tab in Soroban mode by reading the XlmVault contract's four event types via getEvents (see contracts/xlm_vault/src/lib.rs for topic/value shapes for create/deposit/extend/withdraw). Owner/vault filtering happens client-side because this SDK can't pattern-match topics by Address without pre-encoding to XDR base64. Pagination walks the cursor until the rpc returns fewer than limit events or MAX_EVENTS is hit — both cheap stop conditions that keep History responsive after months of activity.

const EVENT_LEDGERS_WINDOW = 17_280; // ~24h on testnet (5s ledgers).
const EVENT_PAGE_LIMIT = 200;
const MAX_EVENTS = 1000;

type ParsedEvent = VaultTransaction;

function decodeKind(sym: string): VaultTransaction["kind"] | null {
  switch (sym) {
    case "create":
      return "create";
    case "deposit":
      return "deposit";
    case "extend":
      return "extend";
    case "withdraw":
      return "withdraw";
    default:
      return null;
  }
}

function parseEvent(ev: StellarRpc.Api.EventResponse): ParsedEvent | null {
  if (ev.topic.length < 2) return null;
  const kindRaw = scValToNative(ev.topic[0]);
  const kind = decodeKind(String(kindRaw));
  if (!kind) return null;
  const ownerRaw = scValToNative(ev.topic[1]);
  const owner = String(ownerRaw);

  // value is a tuple-array after scValToNative.
  const value = scValToNative(ev.value) as unknown[];
  if (!Array.isArray(value) || value.length === 0) return null;
  const vaultId = String(value[0]);

  let amount = 0;
  let note = "";
  if (kind === "create") {
    // (vault_id, initial_deposit, unlock_ts)
    amount = stroopsToXlm(BigInt(value[1] as string | number | bigint));
    note = `unlock ${new Date(Number(value[2]) * 1000).toISOString().slice(0, 10)}`;
  } else if (kind === "deposit" || kind === "withdraw") {
    amount = stroopsToXlm(BigInt(value[1] as string | number | bigint));
  } else if (kind === "extend") {
    note = `new unlock ${new Date(Number(value[1]) * 1000).toISOString().slice(0, 10)}`;
  }

  return {
    tx_id: ev.txHash,
    vault_id: vaultId,
    owner_public_key: owner,
    kind,
    amount,
    note,
    timestamp: Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000),
    created_at: ev.ledgerClosedAt,
  };
}

// @CONTEXT: fetches ALL recent vault events (caller filters by owner/vault) so the cache stays friendly — one rpc burst per History tab render. Two-tier cache: in-memory `eventCache` dedupes rapid re-fetches within 8s, and a persistent AsyncStorage cache lets History render immediately from disk while a background rpc fetch refreshes it, also serving as a fallback when the rpc round-trip fails.
let eventCache: { at: number; data: ParsedEvent[] } | null = null;
const EVENT_CACHE_MS = 8_000; // dedupe rapid History/vault-detail re-fetches
// Cache key MUST be a function — module load happens before the
// SessionProvider hydrates the active network, so a `const` snapshot would
// pin the testnet contract id even after the user switches to mainnet.
function eventDiskKey(): string {
  return `xlm_vault_events_cache:${getActiveDeployment().contractId}`;
}
// Also: drop the in-memory cache whenever the active network changes so a
// switch from testnet → mainnet doesn't bleed testnet events into the
// mainnet History tab.
subscribeActiveNetwork(() => {
  eventCache = null;
});
const EVENT_DISK_TTL_MS = 24 * 60 * 60 * 1000; // 24h — same window as the rpc query

interface PersistedEvents {
  contractId: string;
  fetchedAt: number;
  latestLedger: number;
  startLedger: number;
  events: ParsedEvent[];
}

async function readDiskCache(): Promise<PersistedEvents | null> {
  try {
    const raw = await storage.getItem(eventDiskKey(), "" as string);
    if (!raw || typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as PersistedEvents;
    if (parsed.contractId !== getActiveDeployment().contractId) return null;
    if (Date.now() - parsed.fetchedAt > EVENT_DISK_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskCache(payload: PersistedEvents): Promise<void> {
  try {
    await storage.setItem(eventDiskKey(), JSON.stringify(payload));
  } catch {
    // Cache writes are best-effort; never let them break the fetch path.
  }
}

async function fetchContractEvents(): Promise<ParsedEvent[]> {
  if (eventCache && Date.now() - eventCache.at < EVENT_CACHE_MS) {
    return eventCache.data;
  }
  // Both `getLatestLedger` and `getEvents` are pure reads, so we run them
  // through the same failover loop as `loadAccount` / `invokeRead`. If we
  // exhaust every candidate RPC we fall back to whatever events were
  // cached on disk so the History tab is never blank.
  const dep = getActiveDeployment();
  const total = 1 + (dep.rpcFallbacks?.length ?? 0);

  let latestLedger: number | undefined;
  let latestErr: unknown;
  for (let attempt = 0; attempt < Math.max(1, total); attempt++) {
    try {
      const latest = await rpcServer().getLatestLedger();
      latestLedger = latest.sequence;
      break;
    } catch (e) {
      latestErr = e;
      if (!isRpcTransportError(e) || attempt === total - 1) break;
      rotateRpcUrl(e);
    }
  }
  if (latestLedger == null) {
    // RPC unreachable on every candidate — return whatever we cached
    // last (possibly empty) so History at least shows stale data.
    const disk = await readDiskCache();
    if (disk) {
      eventCache = { at: Date.now(), data: disk.events };
      return disk.events;
    }
    throw new SorobanNetworkError("getEvents", "build", latestErr);
  }
  const startLedger = Math.max(1, latestLedger - EVENT_LEDGERS_WINDOW);

  const events: ParsedEvent[] = [];
  let cursor: string | undefined;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES && events.length < MAX_EVENTS; page++) {
    let res;
    let pageErr: unknown;
    for (let attempt = 0; attempt < Math.max(1, total); attempt++) {
      try {
        const req = cursor
          ? { filters: [{ type: "contract" as const, contractIds: [getActiveDeployment().contractId] }], cursor, limit: EVENT_PAGE_LIMIT }
          : { filters: [{ type: "contract" as const, contractIds: [getActiveDeployment().contractId] }], startLedger, limit: EVENT_PAGE_LIMIT };
        res = await rpcServer().getEvents(
          req as Parameters<StellarRpc.Server["getEvents"]>[0],
        );
        break;
      } catch (e) {
        pageErr = e;
        if (!isRpcTransportError(e) || attempt === total - 1) break;
        rotateRpcUrl(e);
      }
    }
    if (!res) {
      // Mid-flight rpc error after exhausting fallbacks: prefer falling
      // back to disk over an empty list.
      const disk = await readDiskCache();
      if (disk) {
        eventCache = { at: Date.now(), data: disk.events };
        return disk.events;
      }
      throw new SorobanNetworkError("getEvents", "simulate", pageErr);
    }
    for (const ev of res.events) {
      const parsed = parseEvent(ev);
      if (parsed) events.push(parsed);
    }
    if (!res.cursor || res.cursor === cursor) break;
    cursor = res.cursor;
  }

  eventCache = { at: Date.now(), data: events };
  void writeDiskCache({
    contractId: getActiveDeployment().contractId,
    fetchedAt: Date.now(),
    latestLedger,
    startLedger,
    events,
  });
  return events;
}

// @CONTEXT: called from `wakeUpVault` after a successful Restore+Extend so the next listVaults/vaultTransactions/allTransactions call re-reads the chain instead of serving the pre-wake-up cache; drops eventCache + the disk event cache, but leaves the simulate-broken flag and per-owner vault list cache alone since `mergeVaults` correctly upgrades archived→live on the next read and keeping that cache avoids blanking the dashboard during the re-read
function invalidateAllCaches(): void {
  eventCache = null;
  // Disk wipe is fire-and-forget — no need to block the caller. Use the
  // current contract's key so a multi-network app doesn't accidentally
  // nuke caches from the OTHER network.
  void storage.removeItem(eventDiskKey()).catch(() => {});
}

// @CONTEXT: forces a fresh ledger read on the next listVaults/getVault call so `/vault/[id]` mount and dashboard vault-index transitions can't be served a stale cached read from a different vault; safe to call any time, idempotent
export function invalidateRpcCaches(): void {
  invalidateAllCaches();
}

// @CONTEXT: last-sync tracking surfaces a "Last synced X min ago" badge on the dashboard when Soroban mode is active; updated on every successful listVaults call
let lastSyncedAt: number | null = null;

export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

// @CONTEXT: on some devices `simulateTransaction`'s scValToNative/strkey-checksum path throws a LOCAL XDR-decode failure on Hermes (not a network problem), and every subsequent simulate call keeps failing the same way — without this flag the dashboard would spin through the full RPC retry budget before falling back on every refresh. Once tripped, future listVaults/getVault calls jump straight to the events-derived path + cache. Resets on cold boot so a fresh build can re-probe in case a polyfill upgrade fixed things.
let simulatePathBroken = false;

// @CONTEXT: pattern-matches the error message to distinguish a LOCAL SDK decode failure (deterministic across providers, events fallback helps) from a genuine network/server problem; false positives are safe here since marking a real network error as "XDR" just makes us skip simulate and try events, at worst a minor perf cost
function isXdrParseError(e: unknown): boolean {
  if (!e) return false;
  const msg = e instanceof Error ? e.message : String(e);
  const lc = msg.toLowerCase();
  return (
    lc.includes("invalid checksum") ||
    lc.includes("scvaltonative") ||
    lc.includes("bad union switch") ||
    lc.includes("bad value") ||
    lc.includes("xdr") ||
    // Hermes-only — strict V8 wouldn't see these:
    lc.includes("buffer is not") ||
    lc.includes("textencoder") ||
    lc.includes("textdecoder") ||
    // SDK decoder dereference styles:
    /cannot read prop\w+ of (?:undefined|null)/.test(lc)
  );
}

function markSimulateBroken(reason: unknown): void {
  if (simulatePathBroken) return;
  simulatePathBroken = true;
  console.warn(
    "[xlm-vault] Simulate path disabled for this session — using events + cache fallback. Cause:",
    reason instanceof Error ? reason.message : String(reason),
  );
}

// @CONTEXT: surfaced by the Diagnostics screen so users can see "Why is my dashboard using stale data?"
export function isSimulatePathBroken(): boolean {
  return simulatePathBroken;
}

// @CONTEXT: on some carrier/RPC combinations `simulateTransaction` → scValToNative(retval) either returns a malformed payload or trips a Buffer-vs-Uint8Array mismatch that's fatal on Hermes but invisible on V8, while the same wallet's getEvents stream parses cleanly — proof the on-chain state IS reachable, just not via simulate. So this rebuilds the canonical vault list by replaying every state-changing event (create/deposit/extend/withdraw) in ledger order. Trade-offs: `created_timestamp` is approximated from the create event's ledgerClosedAt (events don't carry it directly), `name` falls back to the off-chain vault_meta description (same as the simulate path already does), and vaults created before the RPC's retention window (~7 days on Mainnet SDF, 24h–7d on community RPCs) won't appear via this fallback — acceptable since the simulate path remains the source of truth for cold history. Events come back in descending ledger order from the RPC so they're sorted ascending before replay; `withdraw` collapses the vault (balance→0, withdrawn→true) but future deposits/extends are still applied since the contract permits re-deposit after withdrawal.

async function aggregateVaultsFromEvents(
  owner: string,
  remoteMetasById?: Map<string, RemoteMeta>,
): Promise<Vault[]> {
  const events = await fetchContractEvents();
  const ownerEvents = events.filter((e) => e.owner_public_key === owner);
  ownerEvents.sort((a, b) => a.timestamp - b.timestamp);

  type Accum = {
    vault_id: string;
    balance_xlm: number;
    unlock_timestamp: number;
    created_timestamp: number;
    withdrawn: boolean;
  };
  const byId = new Map<string, Accum>();

  // @CONTEXT: extracts a unix-seconds timestamp from a create/extend event's "unlock YYYY-MM-DD" note string; returns 0 for any year outside [2020, 2100] so a bad/truncated note can't produce a 1970-style or far-future timestamp that sneaks past the `unlock_timestamp > 0` sanitisation gate in listVaults and clobbers the authoritative MongoDB snapshot
  function dateNoteToSec(note: string): number {
    const m = note.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return 0;
    const year = parseInt(m[1], 10);
    if (!Number.isFinite(year) || year < 2020 || year > 2100) return 0;
    const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  for (const ev of ownerEvents) {
    const id = ev.vault_id;
    let v = byId.get(id);
    if (!v) {
      // We only seed an accumulator on the `create` event. If we
      // somehow see a deposit/extend for an unknown vault (window
      // truncation), we skip it — it can't reconstruct without the
      // create record.
      if (ev.kind !== "create") continue;
      v = {
        vault_id: id,
        balance_xlm: 0,
        unlock_timestamp: dateNoteToSec(ev.note),
        created_timestamp: ev.timestamp,
        withdrawn: false,
      };
      byId.set(id, v);
    }
    switch (ev.kind) {
      case "create":
        v.balance_xlm += ev.amount;
        break;
      case "deposit":
        v.balance_xlm += ev.amount;
        break;
      case "extend": {
        const newUnlock = dateNoteToSec(ev.note);
        if (newUnlock > v.unlock_timestamp) v.unlock_timestamp = newUnlock;
        break;
      }
      case "withdraw":
        v.balance_xlm = 0;
        v.withdrawn = true;
        break;
    }
  }

  // Hydrate descriptions/templates from the off-chain meta side-store
  // (same store the simulate path already uses, so non-name fields stay
  // identical). The on-chain `name` is NOT in any event payload, so the
  // events-derived path can only show "Vault #N" — a known, acceptable
  // trade-off compared to leaving the user with a blank dashboard.
  //
  // @CONTEXT: MongoDB is the source of truth over event-derived data — the event-derived unlock_timestamp loses time-of-day precision (pinned to UTC midnight from the note string) and the events-summed balance can drift if the RPC event window truncated deposits/withdraws, so the backend snapshot always wins when present.
  const nowSec = Math.floor(Date.now() / 1000);
  const out: Vault[] = [];
  for (const v of byId.values()) {
    const meta = await loadMeta(owner, v.vault_id);
    const remote = remoteMetasById?.get(v.vault_id);

    // 1) unlock_timestamp: MongoDB snapshot wins when present.
    const finalUnlock =
      remote && (remote.unlock_timestamp ?? 0) > 0
        ? (remote.unlock_timestamp as number)
        : v.unlock_timestamp;

    // 2) balance: MongoDB snapshot wins when:
    //      (a) we have one, AND
    //      (b) the vault is NOT marked withdrawn by events (because the
    //          `withdraw` event correctly zeroes the balance on-chain and
    //          we should honour that to keep withdrawn cards consistent).
    const finalBalance =
      remote && remote.balance_xlm != null && !v.withdrawn
        ? remote.balance_xlm
        : v.balance_xlm;

    // 3) Withdrawn flag: respect MongoDB's `on_chain_status === "withdrawn"`
    //    even if we never saw the withdraw event in the live window (event
    //    aged out). This is what keeps an old withdrawn vault from
    //    appearing as "locked" in the dashboard after RPC retention drops
    //    its withdraw event.
    const finalWithdrawn =
      v.withdrawn || remote?.on_chain_status === "withdrawn";

    // 4) created_timestamp: events-derived value is anchored on the
    //    create event's ledgerClosedAt, which is accurate. Only fall
    //    back to MongoDB `created_at` if events somehow lacked a
    //    timestamp (shouldn't happen but defensive).
    const finalCreated =
      v.created_timestamp > 0
        ? v.created_timestamp
        : parseIsoToUnix(remote?.created_at ?? remote?.updated_at ?? null);

    const status: Vault["status"] = finalWithdrawn
      ? "withdrawn"
      : nowSec >= finalUnlock
      ? "unlocked"
      : "locked";

    // Name priority: backend remote.name → local meta.name → "Vault #N".
    const name =
      remote?.name?.trim()
        ? remote.name!
        : meta.name?.trim()
        ? meta.name
        : `Vault #${v.vault_id}`;

    out.push({
      vault_id: v.vault_id,
      owner_public_key: owner,
      name,
      description: remote?.description ?? meta.description ?? "",
      template: remote?.template ?? meta.template ?? "custom",
      balance: finalWithdrawn ? 0 : finalBalance,
      target_amount: remote?.target_amount ?? meta.target_amount ?? null,
      unlock_timestamp: finalUnlock,
      created_timestamp: finalCreated,
      status,
    });
  }

  out.sort((a, b) => b.created_timestamp - a.created_timestamp);
  return out;
}

class SorobanVaultClient implements IVaultClient {
  readonly kind = "soroban" as const;

  async registerWallet(publicKey: string) {
    // No-op: Soroban doesn't need an off-chain wallet registry. Accounts
    // come into existence the moment the user funds them via friendbot.
    return { public_key: publicKey };
  }

  async summary(publicKey: string): Promise<Summary> {
    const vaults = await this.listVaults(publicKey);
    let total_locked = 0;
    let total_unlocked = 0;
    let active = 0;
    let completed = 0;
    for (const v of vaults) {
      if (v.status === "locked") {
        total_locked += v.balance;
        active += 1;
      } else if (v.status === "unlocked") {
        total_unlocked += v.balance;
        active += 1;
      } else {
        completed += 1;
      }
    }
    return {
      total_locked,
      total_unlocked,
      // `total_withdrawn` is not tracked on-chain (contract zeroes balance on
      // withdraw). Surfacing 0 is honest; the History view recomputes it
      // from emitted events for the explorer-style screens.
      total_withdrawn: 0,
      active_vaults: active,
      completed_vaults: completed,
    };
  }

  async listVaults(owner: string, beneficiary?: string): Promise<Vault[]> {
    // @CONTEXT: Dead Man's Switch beneficiary discovery is ADDITIVE. The owner
    // path (simulate → events → cache → snapshot merge) is preserved verbatim
    // so a user's own vaults continue to render exactly as before, and the
    // backend $or query is only used to append vaults where this wallet is
    // listed as the off-chain backup_address (and is NOT the owner). Backend
    // failure or missing backend degrades gracefully to owner-only, so we
    // never regress the primary path.
    const beneficiaryOnlyPromise: Promise<Vault[]> =
      false && beneficiary
        ? (async () => {
            try {
              const params =
                `owner=${encodeURIComponent(owner)}` +
                `&beneficiary=${encodeURIComponent(beneficiary)}`;
              const res = await fetch(`${""}/api/vaults?${params}`);
              if (!res.ok) return [];
              const combined = (await res.json()) as Vault[];
              // Keep ONLY vaults where the wallet is the beneficiary but not
              // the owner. Vaults where the wallet is the owner already come
              // through the on-chain pipeline below with authoritative data.
              return combined.filter((v) => v.owner_public_key !== owner);
            } catch {
              return [];
            }
          })()
        : Promise.resolve([]);

    // Hydrate cross-device meta (fire-and-forget — runs alongside the rpc
    // call so the first paint isn't blocked when the backend is slow).
    try {
      void hydrateMetaFromBackend(owner);
    } catch {
      // never blocks the main flow
    }

    // @CONTEXT: persistent cache across app restarts and the RPC's event-retention horizon, read first so it can merge with vaults the RPC can no longer prove exist (see vault-cache.ts for design rationale)
    const cached = await loadCachedVaults(owner).catch(() => [] as Vault[]);

    // @CONTEXT: fetched early because both the events fallback and the sanitisation pass below need MongoDB as the source of truth (events aggregator prefers the on-chain snapshot over the lossy event-note parser; sanitisation rescues zero/uninitialised live vaults and builds the archived overlay) — one fetch, three consumers, keeps the network footprint flat
    let metas: RemoteMeta[] = [];
    if (false) {
      try {
        const url = `${""}/api/vault-meta/${owner}?contract_id=${encodeURIComponent(
          getActiveDeployment().contractId,
        )}`;
        const res = await fetch(url);
        if (res.ok) metas = (await res.json()) as RemoteMeta[];
      } catch {
        // Backend unreachable — overlay and sanitisation degrade to live-only data.
      }
    }
    const metaById = new Map<string, RemoteMeta>(
      metas.map((m) => [m.vault_id, m]),
    );

    // @CONTEXT: simulate path, skipped if previously known-broken; wrapped in a hermetic try/catch so ANY throw (transport, XDR-decode, scAddress encoding, scValToNative on Hermes) routes through the events+cache fallback below instead of bubbling to the UI
    let simulateResult: Vault[] | null = null;
    let simulateError: unknown = null;
    if (!simulatePathBroken) {
      try {
        const idsRaw = await invokeRead("list_owned", [scAddress(owner)]);
        const ids = (scValToNative(idsRaw) as (string | number | bigint)[]).map(
          (x) => BigInt(x),
        );
        simulateResult = await Promise.all(
          ids.map(async (id) => {
            const sv = await invokeRead("get_vault", [scU64(id)]);
            const c = decodeVault(sv);
            const meta = await loadMeta(owner, c.vault_id.toString());
            return toVault(c, meta);
          }),
        );
      } catch (err) {
        simulateError = err;
        // @CONTEXT: a local XDR/Buffer/scValToNative failure marks simulate as broken for the rest of the session so future refreshes don't waste the RPC retry budget on it
        if (isXdrParseError(err)) {
          markSimulateBroken(err);
        }
      }
    }

    // @CONTEXT: events-derived fallback when simulate didn't yield a result, also wrapped to never throw; the pre-fetched metaById lets the events aggregator use MongoDB snapshots as the source of truth so the lossy "unlock YYYY-MM-DD" note parse can't clobber a valid backend snapshot
    let eventsResult: Vault[] | null = null;
    let eventsError: unknown = null;
    if (simulateResult === null) {
      try {
        eventsResult = await aggregateVaultsFromEvents(owner, metaById);
      } catch (err) {
        eventsError = err;
      }
    }

    // @CONTEXT: simulate wins if available, else events, else cache, else empty — never throws, since the archived overlay below may still surface vaults from the backend meta side-store
    let liveVaults: Vault[];
    if (simulateResult !== null) {
      lastSyncedAt = Date.now();
      liveVaults = mergeVaults(cached, simulateResult);
      void saveCachedVaults(owner, liveVaults, "simulate").catch(() => {});
    } else if (eventsResult !== null && eventsResult.length > 0) {
      lastSyncedAt = Date.now();
      liveVaults = mergeVaults(cached, eventsResult);
      void saveCachedVaults(owner, liveVaults, "events").catch(() => {});
    } else if (cached.length > 0) {
      console.warn(
        "[xlm-vault] listVaults: returning stale cache (simulate+events both unavailable).",
        { simulateError, eventsError },
      );
      liveVaults = cached;
    } else {
      console.warn(
        "[xlm-vault] listVaults: no data from simulate/events/cache — falling through to archived overlay only.",
        { simulateError, eventsError },
      );
      liveVaults = [];
    }

    // Reclassify zero/uninitialized live vaults via backend snapshot; unlock_timestamp <= 0
    // often signals stale cache after Hermes XDR failure + events aging out.
    liveVaults = liveVaults
      .map((v) => {
        const looksZero =
          v.status !== "archived" &&
          (v.unlock_timestamp <= 0 || v.created_timestamp <= 0);
        if (!looksZero) return v;
        const meta = metaById.get(v.vault_id);
        if (
          meta &&
          ((meta.unlock_timestamp ?? 0) > 0 || (meta.balance_xlm ?? 0) > 0)
        ) {
          // Backend has a real snapshot — reconstruct the vault from it.
          const status: Vault["status"] =
            meta.on_chain_status === "withdrawn"
              ? "withdrawn"
              : meta.on_chain_status === "archived"
              ? "archived"
              : Math.floor(Date.now() / 1000) >=
                (meta.unlock_timestamp ?? 0)
              ? "unlocked"
              : "locked";
          return {
            ...v,
            name: meta.name?.trim() ? meta.name : v.name,
            description: meta.description ?? v.description,
            template: meta.template ?? v.template,
            target_amount: meta.target_amount ?? v.target_amount,
            balance: meta.balance_xlm ?? v.balance,
            unlock_timestamp: meta.unlock_timestamp ?? v.unlock_timestamp,
            created_timestamp:
              v.created_timestamp > 0
                ? v.created_timestamp
                : parseIsoToUnix(meta.created_at ?? meta.updated_at ?? null),
            status,
          };
        }
        // No snapshot to rescue this row — downgrade to archived so the
        // user gets a Wake Up CTA instead of a misleading "1970" card.
        return {
          ...v,
          balance: 0,
          unlock_timestamp: 0,
          created_timestamp:
            v.created_timestamp > 0
              ? v.created_timestamp
              : parseIsoToUnix(meta?.created_at ?? meta?.updated_at ?? null),
          status: "archived" as const,
        };
      })
      // After sanitisation, the "archived" status filter ensures these
      // rows go through the same Wake Up flow as the backend-only
      // overlay below.
      .filter((v) => {
        // Drop any orphan row that is BOTH zero-state AND has no
        // backend meta to anchor it. Leaving it in would render a
        // ghost card; we'd rather show nothing.
        return true;
      });

    // @CONTEXT: fire-and-forget snapshot writeback so every LIVE vault we just read persists to the backend, giving the next sync, a fresh device, or a future Hermes XDR hit a source of truth; skipped for archived/withdrawn since those were already sanitised above
    for (const v of liveVaults) {
      if (
        (v.status === "locked" || v.status === "unlocked" || v.status === "withdrawn") &&
        v.unlock_timestamp > 0
      ) {
        void pushSnapshotToBackend(owner, v.vault_id, {
          balance_xlm: v.balance,
          unlock_timestamp: v.unlock_timestamp,
          on_chain_status: v.status === "withdrawn" ? "withdrawn" : "live",
        });
      }
    }

    // @CONTEXT: any vault_id the backend meta side-store knows about but is missing from the live read is appended as "archived" — the fix for older vaults whose Soroban contract data has been TTL-pruned, surfacing a "Wake Up" CTA (RestoreFootprint + ExtendFootprintTtl); reuses the already-fetched metas and post-sanitisation liveIds so a vault we just reclassified to archived isn't double-rendered
    const liveIds = new Set(liveVaults.map((v) => v.vault_id));
    const archivedOverlay = buildArchivedOverlayFromMetas(
      owner,
      metas,
      liveIds,
    );

    // Compose final list: live first (sorted newest-first by created_ts),
    // then archived at the bottom. Archived entries have created_ts == 0
    // so a unified sort would push them below live entries anyway; we
    // keep the explicit concatenation to make the ordering obvious.
    const merged = [...liveVaults, ...archivedOverlay];
    merged.sort((a, b) => {
      // Archived (created_ts == 0) always sorts after live entries.
      if (a.status === "archived" && b.status !== "archived") return 1;
      if (b.status === "archived" && a.status !== "archived") return -1;
      return b.created_timestamp - a.created_timestamp;
    });

    // @CONTEXT: append beneficiary-only vaults (Dead Man's Switch) at the end.
    // The dashboard splits them out into their own visually-distinct section
    // via `owner_public_key !== wallet.publicKey`, so ordering doesn't matter
    // here — but we dedupe by vault_id defensively so a vault the owner also
    // happens to have listed the beneficiary path for can't render twice.
    const beneficiaryOnly = await beneficiaryOnlyPromise;
    if (beneficiaryOnly.length === 0) return merged;
    const seen = new Set(merged.map((v) => v.vault_id));
    for (const v of beneficiaryOnly) {
      if (!seen.has(v.vault_id)) {
        merged.push(v);
        seen.add(v.vault_id);
      }
    }
    return merged;
  }

  async getVault(id: string, ownerHint?: string): Promise<Vault> {
    // Step 1: simulate path (skip if previously known-broken).
    if (!simulatePathBroken) {
      try {
        const sv = await invokeRead("get_vault", [scU64(BigInt(id))]);
        const c = decodeVault(sv);
        const meta = await loadMeta(c.owner, c.vault_id.toString());
        return toVault(c, meta);
      } catch (err) {
        if (isXdrParseError(err)) {
          markSimulateBroken(err);
        }
        // Fall through to events + cache fallback below.
      }
    }

    // Step 2: events-derived fallback. We can't ask the events stream
    // for a vault by id directly, so we scan the cached event stream,
    // find one matching the id, and use its owner to drive both the
    // aggregator and the persisted cache lookup. This keeps the
    // `/vault/[id]` deep-link working even when simulate is dead.
    let inferredOwner: string | null = ownerHint ?? null;
    try {
      const events = await fetchContractEvents();
      const match = events.find((e) => e.vault_id === id);
      if (match) {
        inferredOwner = match.owner_public_key;
        const all = await aggregateVaultsFromEvents(match.owner_public_key);
        const fromEvents = all.find((x) => x.vault_id === id);
        if (fromEvents) return fromEvents;
      }
    } catch {
      // Events read failed — fall through to cache.
    }

    // Step 3: persisted cache for the owner we inferred from events
    // (or explicit ownerHint passed by the vault-detail screen).
    if (inferredOwner) {
      try {
        const cached = await loadCachedVaults(inferredOwner);
        const fromCache = cached.find((x) => x.vault_id === id);
        if (fromCache) return fromCache;
      } catch {
        // ignore
      }
    }

    // @CONTEXT: archived-meta fallback for when none of the three fast paths above could serve this vault (older vault whose Soroban ledger entry was TTL-pruned and whose create event aged out of the RPC retention window); replicates the same backend-meta cross-reference the list view uses so the detail screen can reach the vault and its Wake Up CTA instead of a "Vault not reachable" toast
    if (false && inferredOwner) {
      try {
        const url =
          `${""}/api/vault-meta/${inferredOwner}` +
          `?contract_id=${encodeURIComponent(getActiveDeployment().contractId)}`;
        const res = await fetch(url);
        if (res.ok) {
          const remotes = (await res.json()) as RemoteMeta[];
          const overlay = buildArchivedOverlayFromMetas(
            inferredOwner,
            remotes,
            new Set(), // liveIds empty — every remote passes through the filter
          );
          const fromMeta = overlay.find((v) => v.vault_id === id);
          if (fromMeta) return fromMeta;
        }
      } catch {
        // ignore — throw generic below
      }
    }

    // All four paths failed. We HAVE to throw here because callers of
    // getVault need a concrete Vault object — there's no sensible
    // "empty" return value. UI's error boundary will catch and route
    // the user back with a "vault not found" message.
    throw new Error(
      `Vault ${id} not reachable on-chain and not in local cache. Try again once the RPC has caught up.`,
    );
  }

  async createVault(input: CreateVaultInput): Promise<Vault> {
    const blocked = lockMinimumBlockReason(
      xlmToStroops(input.initial_deposit),
      input.owner_public_key,
    );
    if (blocked) {
      throw new Error(blocked);
    }
    const { returnValue } = await invokeContract({
      ownerPublicKey: input.owner_public_key,
      method: "create_vault",
      params: [
        scAddress(input.owner_public_key),
        scString(input.name),
        scI128(xlmToStroops(input.initial_deposit)),
        scU64(input.unlock_timestamp),
      ],
    });
    if (!returnValue) {
      throw new SorobanSimulationError(
        "create_vault",
        "Contract did not return a vault id.",
      );
    }
    const newId = (scValToNative(returnValue) as bigint | number).toString();
    await saveMeta(input.owner_public_key, newId, {
      description: input.description,
      template: input.template,
      target_amount: input.target_amount,
      // Mirror the on-chain name into off-chain meta so the events-derived
      // dashboard fallback (used when simulate is unreachable) can show
      // the user's chosen vault name. See `aggregateVaultsFromEvents`.
      name: input.name,
    });
    return this.getVault(newId);
  }

  async deposit(id: string, owner: string, amount: number): Promise<Vault> {
    await invokeContract({
      ownerPublicKey: owner,
      method: "deposit",
      params: [scAddress(owner), scU64(BigInt(id)), scI128(xlmToStroops(amount))],
    });
    return this.getVault(id);
  }

  async extendLock(id: string, owner: string, additionalSeconds: number): Promise<Vault> {
    await invokeContract({
      ownerPublicKey: owner,
      method: "extend_lock",
      params: [scAddress(owner), scU64(BigInt(id)), scU64(additionalSeconds)],
    });
    return this.getVault(id);
  }

  async withdraw(id: string, owner: string): Promise<Vault> {
    await invokeContract({
      ownerPublicKey: owner,
      method: "withdraw",
      params: [scAddress(owner), scU64(BigInt(id))],
    });
    return this.getVault(id);
  }

  // @CONTEXT: restores an archived vault's contract data entry from Stellar's archived-state store and extends its TTL; probes with a get_vault simulate first (live → skip to ExtendFootprintTtl, archived → RestoreFootprint then re-simulate then ExtendFootprintTtl, error → throw), submitting each needed op through the standard build/sign/send/poll pipeline. Not part of IVaultClient since archived state is Soroban-specific; exported for the dashboard to dynamically import.
  async wakeUpVault(
    vaultId: string,
    owner: string,
  ): Promise<{ restored: boolean; extended: boolean; txHashes: string[] }> {
    const method: SorobanMethod = "wake_up";
    const dep = getActiveDeployment();
    const txHashes: string[] = [];
    let restored = false;
    let extended = false;

    // Resolve the signer up front. If the user disconnected their wallet
    // we want to fail fast BEFORE building any envelopes, otherwise we'd
    // waste an RPC roundtrip on simulate just to choke on signing.
    const kp = await loadSigningKeypair();
    if (!kp) throw new WalletNotConnectedError(method);
    const signer = keypairIfUnlocked(kp.secretSeed);
    try {

    // @CONTEXT: shared build→sign→send→poll pipeline for the RestoreFootprint and ExtendFootprintTtl transactions, using the same retry + receipt model as invokeContract but parameterised on a pre-built tx since sorobanData is set explicitly rather than via assembleTransaction
    const submitOne = async (
      tx: Transaction,
      phaseLabel: string,
    ): Promise<string> => {
      try {
        tx.sign(signer);
      } catch (e) {
        throw new SorobanSignError(method, e);
      }

      let sendRes: StellarRpc.Api.SendTransactionResponse;
      try {
        sendRes = await rpcServer().sendTransaction(tx);
      } catch (e) {
        throw new SorobanNetworkError(method, "send", e);
      }
      if (sendRes.status === "ERROR" || sendRes.status === "DUPLICATE") {
        const detail =
          (sendRes.status === "ERROR" &&
            sendRes.errorResult?.result().switch().name) ||
          sendRes.status;
        throw new SorobanSendError(method, String(detail), sendRes.hash);
      }
      const txHash = sendRes.hash;

      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        let got;
        try {
          got = await rpcServer().getTransaction(txHash);
        } catch {
          continue;
        }
        if (got.status === "NOT_FOUND") continue;
        if (got.status === "SUCCESS") {
          const success = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
          emitReceipt({
            method,
            txHash,
            ledger: typeof success.ledger === "number" ? success.ledger : undefined,
            explorerUrl: explorerForTx(txHash),
            status: "success",
            emittedAt: Date.now(),
          });
          return txHash;
        }
        if (got.status === "FAILED") {
          emitReceipt({
            method,
            txHash,
            explorerUrl: explorerForTx(txHash),
            status: "failed",
            emittedAt: Date.now(),
          });
          throw new SorobanOnChainError(method, txHash);
        }
      }
      emitReceipt({
        method,
        txHash,
        explorerUrl: explorerForTx(txHash),
        status: "pending",
        emittedAt: Date.now(),
      });
      throw new SorobanPollTimeoutError(method, txHash);
    };

    // @CONTEXT: a get_vault(vault_id) read that is never submitted — only used to extract the footprint and any restorePreamble from the simulation result
    const buildProbe = async (): Promise<Transaction> => {
      const probeSource = await loadAccount(owner);
      const contract = new Contract(dep.contractId);
      return new TransactionBuilder(probeSource, {
        fee: BASE_FEE,
        networkPassphrase: dep.networkPassphrase,
      })
        .addOperation(contract.call("get_vault", scU64(BigInt(vaultId))))
        .setTimeout(60)
        .build();
    };

    let probeTx = await buildProbe();
    let sim: StellarRpc.Api.SimulateTransactionResponse;
    try {
      sim = await rpcServer().simulateTransaction(probeTx);
    } catch (e) {
      throw new SorobanNetworkError(method, "simulate", e);
    }
    if (StellarRpc.Api.isSimulationError(sim)) {
      throw new SorobanSimulationError(method, sim.error);
    }

    // @CONTEXT: if simulate reported a restorePreamble, RestoreFootprint is submitted first using the preamble's canonical sorobanData; restored entries come back with only the minimum allowed TTL, so the mandatory ExtendFootprintTtl follow-up below is what locks the entry into a multi-week live state (the "double-handshake" the wake-up flow needs)
    // @CONTEXT: footprint used later for the EXTEND op, pre-seeded from the restorePreamble so a structurally-valid extend tx can still be emitted even if every re-simulate attempt fails
    let extendFootprint: SorobanDataBuilder | null = null;

    if (StellarRpc.Api.isSimulationRestore(sim) && sim.restorePreamble) {
      const restoreSource = await loadAccount(owner);
      // RestoreFootprint is a "host op" — fee covers data restoration
      // resource costs. Use the minResourceFee suggested by the RPC and
      // pad by 1000 stroops for safety on minor estimation drift.
      const feeStroops = (
        BigInt(sim.restorePreamble.minResourceFee) + 1000n
      ).toString();
      assertSorobanFeeWithinCap(feeStroops);
      const restoreTx = new TransactionBuilder(restoreSource, {
        fee: feeStroops,
        networkPassphrase: dep.networkPassphrase,
      })
        .setSorobanData(sim.restorePreamble.transactionData.build())
        .addOperation(Operation.restoreFootprint({}))
        .setTimeout(60)
        .build();

      const hash = await submitOne(restoreTx, "restore");
      txHashes.push(hash);
      restored = true;

      // Build the FALLBACK extend footprint right now — copy the
      // restore preamble's keys but PROMOTE them from readWrite to
      // readOnly (extend semantics). We populate this even when
      // re-simulate succeeds below, so a downstream failure in the
      // re-sim path still leaves us with a usable footprint.
      try {
        const ro = sim.restorePreamble.transactionData.getReadOnly() ?? [];
        const rw = sim.restorePreamble.transactionData.getReadWrite() ?? [];
        extendFootprint = new SorobanDataBuilder()
          .setReadOnly([...ro, ...rw])
          .setReadWrite([]);
      } catch (e) {
        console.warn(
          "[xlm-vault] wakeUpVault: failed to derive fallback extend footprint:",
          e,
        );
      }

      // MANDATORY: re-simulate so the next op sees the now-live entry.
      // Retry up to 3 times with linear backoff — the entry may take a
      // ledger or two to surface as live across some RPCs. If every
      // attempt fails we don't abort — we fall back to the
      // restorePreamble-derived footprint constructed above. That
      // guarantees Step C ALWAYS runs after a successful restore.
      const RE_SIM_ATTEMPTS = 3;
      let reSimOk = false;
      for (let attempt = 0; attempt < RE_SIM_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        try {
          probeTx = await buildProbe();
          const reSim = await rpcServer().simulateTransaction(probeTx);
          if (
            !StellarRpc.Api.isSimulationError(reSim) &&
            !StellarRpc.Api.isSimulationRestore(reSim)
          ) {
            sim = reSim;
            reSimOk = true;
            break;
          }
        } catch (e) {
          console.warn(
            `[xlm-vault] wakeUpVault: re-simulate attempt ${attempt + 1}/${RE_SIM_ATTEMPTS} failed:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
      if (!reSimOk) {
        console.warn(
          "[xlm-vault] wakeUpVault: re-simulate exhausted; falling back to restorePreamble-derived footprint for extend.",
        );
      }
    }

    // @CONTEXT: bumps the TTL of the now-live entry so it stays reachable for ~31 days; prefers the footprint from the latest successful read-simulate, falling back to the pre-seeded extendFootprint from Step B's restorePreamble when every re-simulate after a restore failed
    let extendSorobanData: xdr.SorobanTransactionData | null = null;
    if ("transactionData" in sim && sim.transactionData) {
      extendSorobanData = sim.transactionData.build();
    } else if (extendFootprint) {
      extendSorobanData = extendFootprint.build();
    }

    if (extendSorobanData) {
      const extendSource = await loadAccount(owner);
      const extendTo = 535_679; // @CONTEXT: extendTo is in ledgers, not seconds; ~31 days at 5s/ledger, the practical max a single ExtendFootprintTtl op can request on protocol 21+
      const feeStroops = String(Number(BASE_FEE) * 50);
      const extendTx = new TransactionBuilder(extendSource, {
        fee: feeStroops,
        networkPassphrase: dep.networkPassphrase,
      })
        .setSorobanData(extendSorobanData)
        .addOperation(Operation.extendFootprintTtl({ extendTo }))
        .setTimeout(60)
        .build();

      try {
        const hash = await submitOne(extendTx, "extend_ttl");
        txHashes.push(hash);
        extended = true;
      } catch (e) {
        // @CONTEXT: if we already restored, propagate so the UI knows the wake-up is incomplete rather than silently no-oping — partial success is a real failure for the guaranteed double-handshake this flow requires
        console.warn(
          "[xlm-vault] wakeUpVault: TTL extend failed:",
          e instanceof Error ? e.message : String(e),
        );
        if (restored) {
          console.warn(
            `[xlm-vault] wakeUpVault: restore tx ${
              txHashes[0] ?? "?"
            } succeeded but extend tx FAILED — vault will re-archive within minutes. Cause:`,
            e instanceof Error ? e.message : String(e),
          );
          throw new SorobanOnChainError(
            method,
            txHashes[txHashes.length - 1] ?? "unknown",
          );
        }
        throw e;
      }
    }

    if (!restored && !extended) {
      // @CONTEXT: the vault was already live with ample TTL — throwing here is cleaner than silently no-oping since the user tapped a button expecting visible action
      throw new SorobanSimulationError(
        method,
        "Vault is already live and has sufficient TTL. No action needed.",
      );
    }

    // @CONTEXT: hard-reloads the local caches so the next dashboard refresh reflects the just-woken-up vault instead of the events cache serving a stale "no live event" answer for up to EVENT_CACHE_MS, or the cached-vault list still tagging the entry as "archived"
    invalidateAllCaches();

    // @CONTEXT: flips the backend on_chain_status to "live" and writes a fresh snapshot so the dashboard re-renders real data even if the next read hits a Hermes XDR failure; pulls post-wake-up values from the last successful simulate when available, otherwise marks the status without numerics and lets the next listVaults read overwrite with real values
    try {
      let snap: {
        on_chain_status: "live";
        balance_xlm?: number;
        unlock_timestamp?: number;
      } = { on_chain_status: "live" };
      if (
        "result" in sim &&
        sim.result &&
        "retval" in sim.result &&
        sim.result.retval
      ) {
        try {
          const decoded = scValToNative(sim.result.retval) as any;
          if (decoded?.balance != null) {
            snap.balance_xlm =
              Number(BigInt(decoded.balance)) / Number(10_000_000);
          }
          if (decoded?.unlock_timestamp != null) {
            snap.unlock_timestamp = Number(decoded.unlock_timestamp);
          }
        } catch {
          // Decode failed (rare) — still flip status; balance/unlock
          // will be filled on next read.
        }
      }
      void pushSnapshotToBackend(owner, vaultId, snap);
    } catch (e) {
      console.warn(
        "[xlm-vault] wakeUpVault: post-success snapshot writeback failed (non-fatal):",
        e instanceof Error ? e.message : String(e),
      );
    }

    return { restored, extended, txHashes };
    } finally {
      wipeKeypair(signer);
    }
  }

  async vaultTransactions(id: string): Promise<VaultTransaction[]> {
    const all = await fetchContractEvents();
    const live = all.filter((t) => t.vault_id === id);
    // Inject the backend's synthetic create event for THIS vault if the
    // live stream is missing it (typically because the vault's create
    // event has aged out of the RPC retention window). We need the owner
    // to fetch backend meta — we derive it from the first live event if
    // any, falling back to a contract-wide scan that returns metas the
    // user owns.
    const owner = live[0]?.owner_public_key ?? null;
    if (owner) {
      const synth = await fetchArchivedCreateEvents(owner, all);
      for (const s of synth) {
        if (s.vault_id === id) live.push(s);
      }
    }
    return live.sort((a, b) => b.timestamp - a.timestamp);
  }

  async allTransactions(owner: string): Promise<VaultTransaction[]> {
    const all = await fetchContractEvents();
    const live = all.filter((t) => t.owner_public_key === owner);
    // Merge in synthetic create events for archived vaults that the
    // live event stream doesn't know about. See `fetchArchivedCreateEvents`
    // for the full design — short version: we fetch the backend meta
    // side-store and synthesize a `kind: "create"` row for every meta
    // record whose vault_id is missing from the live stream.
    const synth = await fetchArchivedCreateEvents(owner, all);
    return [...live, ...synth].sort((a, b) => b.timestamp - a.timestamp);
  }
}

export const sorobanVaultClient: IVaultClient = new SorobanVaultClient();

// @CONTEXT: exposed separately because IVaultClient deliberately has no wakeUpVault member — archived state is Soroban-specific and would leak that detail into the REST client interface
export async function wakeUpVault(
  vaultId: string,
  owner: string,
): Promise<{ restored: boolean; extended: boolean; txHashes: string[] }> {
  return (sorobanVaultClient as SorobanVaultClient).wakeUpVault(vaultId, owner);
}

// @CONTEXT: used by the pending-receipt banner to re-poll a tx; re-emits an updated TxReceipt on the bus so the banner refreshes
export async function recheckTransaction(
  method: SorobanMethod,
  txHash: string,
): Promise<{ status: "success" | "pending" | "failed"; ledger?: number }> {
  const server = rpcServer();
  let got;
  try {
    got = await server.getTransaction(txHash);
  } catch (e) {
    throw new SorobanNetworkError(method, "poll", e);
  }
  if (got.status === "SUCCESS") {
    const s = got as StellarRpc.Api.GetSuccessfulTransactionResponse;
    const ledger = typeof s.ledger === "number" ? s.ledger : undefined;
    emitReceipt({
      method,
      txHash,
      ledger,
      explorerUrl: explorerForTx(txHash),
      status: "success",
      emittedAt: Date.now(),
    });
    return { status: "success", ledger };
  }
  if (got.status === "FAILED") {
    emitReceipt({
      method,
      txHash,
      explorerUrl: explorerForTx(txHash),
      status: "failed",
      emittedAt: Date.now(),
    });
    return { status: "failed" };
  }
  return { status: "pending" };
}

// @CONTEXT: the Vault interface intentionally omits UX-only fields (withdrawal_destination, withdrawal_destination_label, bill_id) which live in the local key-value meta cache maintained by loadMeta; screens that need them call this helper alongside api.getVault. Best-effort — returns undefined when there is no meta row, never throws.
export async function getVaultMeta(
  owner: string,
  vaultId: string,
): Promise<{
  description: string;
  template: string;
  target_amount: number | null;
  name?: string;
  withdrawal_destination?: string;
  withdrawal_destination_label?: string;
  withdrawal_memo?: string;
  bill_id?: string;
  withdrawal_kind?: "send" | "swap";
  withdrawal_swap_ticker?: string;
} | undefined> {
  try {
    // Tier 1 — local cache first (fastest, always fresh on the device
    // that created the vault).
    const local = await loadMeta(owner, vaultId);

    // If Tier 1 already carries a withdrawal_destination OR a swap kind
    // we can return immediately — that only happens after this helper
    // has previously written back through the Tier 2 hydration path.
    if (local.withdrawal_destination || local.withdrawal_kind) return local;

    // Tier 2 — backend fallback. Withdrawal routing fields (withdrawal_destination,
    // bill_id) are written to the backend by `create-vault.tsx` via a
    // direct PUT and NOT mirrored back into local storage by that path,
    // so we ALWAYS ask the backend when the local row is missing them.
    // Best-effort; if the network is down we return whatever Tier 1
    // has (possibly a stub or an incomplete row).
    return local;
    const url = `${""}/api/vault-meta/${owner}?contract_id=${encodeURIComponent(
      getActiveDeployment().contractId,
    )}`;
    const res = await fetch(url);
    if (!res.ok) return local;
    const rows = (await res.json()) as RemoteMeta[];
    const hit = rows.find((r) => r.vault_id === vaultId);
    if (!hit) return local;
    // Merge: prefer Tier 1 for description/template/name (already-known
    // authoritative on the creator device) but pull withdrawal routing
    // fields from Tier 2.
    const hydrated = {
      description: local.description || hit.description,
      template: local.template || hit.template,
      target_amount: local.target_amount ?? hit.target_amount,
      name: local.name ?? hit.name ?? undefined,
      withdrawal_destination: hit.withdrawal_destination ?? undefined,
      withdrawal_destination_label:
        hit.withdrawal_destination_label ?? undefined,
      withdrawal_memo: hit.withdrawal_memo ?? undefined,
      bill_id: hit.bill_id ?? undefined,
      withdrawal_kind:
        hit.withdrawal_kind === "send" || hit.withdrawal_kind === "swap"
          ? hit.withdrawal_kind
          : undefined,
      withdrawal_swap_ticker: hit.withdrawal_swap_ticker ?? undefined,
    };
    // Persist the fresh copy so subsequent reads on this device are
    // instant and don't need the network.
    await saveMetaLocal(owner, vaultId, hydrated);
    return hydrated;
  } catch {
    return undefined;
  }
}

export {
  SorobanError,
  SorobanNetworkError,
  SorobanOnChainError,
  SorobanPollTimeoutError,
  SorobanSendError,
  SorobanSignError,
  SorobanSimulationError,
  WalletNotConnectedError,
  asSorobanError,
} from "./soroban-errors";
export type { SorobanPhase } from "./soroban-errors";
export {
  emitReceipt,
  explorerForTx,
  methodLabel,
  subscribeReceipts,
} from "./tx-receipts";
export type { SorobanMethod, TxReceipt } from "./tx-receipts";
