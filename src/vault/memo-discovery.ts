/**
 * Scan the wallet's Horizon payment history for vault notification memos
 * and hydrate discovered multi-party vaults (Dead Man's Switch beneficiary,
 * Multi-Sig co-signer) — fully local, no backend.
 */

import { StrKey } from "@stellar/stellar-sdk";

import { storage } from "@/src/utils/storage";
import {
  formatVaultMemo,
  isContractRef,
  isVaultIdRef,
  parseVaultMemoText,
  VAULT_NOTIFY_AMOUNT_XLM,
} from "@/src/vault/memo-format";
import {
  listMultiSigEntries,
  upsertMultiSigEntry,
  type MultiSigEntry,
} from "@/src/vault/multi-sig-store";
import {
  getAdvancedVault,
  getMultiSigVault,
  getMultiSigWithdrawalRequest,
  stroopsToFloat,
  type AdvancedVaultRecord,
} from "@/src/wallet/advanced-vaults";
import { fetchWalletPayments, type WalletPayment } from "@/src/wallet/horizon";

const CACHE_KEY = "xlm_vault_memo_discovery_cache_v1";
/** Soft amount match — Horizon may serialize 0.0001 with trailing zeros. */
const AMOUNT_EPS = 0.0000001;
const SCAN_LIMIT = 200;

export type DiscoveredRole = "beneficiary" | "co_signer";

export interface DiscoveredVaultRecord {
  /** Stable cache key: `dms:<id>` or `msig:<C-address>`. */
  key: string;
  kind: "DeadManSwitch" | "MultiSig";
  role: DiscoveredRole;
  /** Decimal vault id (DMS) or contract C-address (Multi-Sig). */
  ref: string;
  logicalMemo: string;
  counterparty: string;
  txHash: string;
  discoveredAt: number;
  /** Soft badge until the user opens / dismisses. */
  isNew: boolean;
  /** Hydrated display fields (best-effort). */
  name: string;
  owner: string;
  balanceXlm: number;
  /** Multi-Sig only — true when a withdrawal awaits co-signer approval. */
  pendingApproval: boolean;
  /** DMS only — mirrored AdvancedVaultRecord when hydration succeeds. */
  advanced?: AdvancedVaultRecord;
}

interface CacheFile {
  byWallet: Record<
    string,
    {
      scannedAt: number;
      /** Last payment paging token / tx hash we fully processed. */
      cursorTxHash?: string;
      vaults: DiscoveredVaultRecord[];
    }
  >;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeDiscoveredVaults(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notifyListeners(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* subscriber must not break publisher */
    }
  }
}

async function readCache(): Promise<CacheFile> {
  const raw = await storage.getItem<CacheFile>(CACHE_KEY, { byWallet: {} });
  if (!raw || typeof raw !== "object" || !raw.byWallet) return { byWallet: {} };
  return raw;
}

async function writeCache(file: CacheFile): Promise<void> {
  await storage.setItem(CACHE_KEY, file);
  notifyListeners();
}

export async function getCachedDiscoveredVaults(
  walletPublicKey: string,
): Promise<DiscoveredVaultRecord[]> {
  const file = await readCache();
  return file.byWallet[walletPublicKey]?.vaults ?? [];
}

export async function markDiscoveredVaultSeen(
  walletPublicKey: string,
  key: string,
): Promise<void> {
  const file = await readCache();
  const slot = file.byWallet[walletPublicKey];
  if (!slot) return;
  let changed = false;
  for (const v of slot.vaults) {
    if (v.key === key && v.isNew) {
      v.isNew = false;
      changed = true;
    }
  }
  if (changed) await writeCache(file);
}

export function countNewDiscovered(vaults: DiscoveredVaultRecord[]): number {
  return vaults.filter((v) => v.isNew).length;
}

/**
 * Decode a Horizon MEMO_HASH (base64) into a Soroban C-address.
 * Returns null when the payload isn't a valid 32-byte contract id.
 */
export function contractIdFromMemoHash(memo: string): string | null {
  if (!memo) return null;
  try {
    const buf = Buffer.from(memo, "base64");
    if (buf.length !== 32) return null;
    return StrKey.encodeContract(buf);
  } catch {
    return null;
  }
}

function amountLooksLikeNotify(amount: number): boolean {
  return Math.abs(amount - VAULT_NOTIFY_AMOUNT_XLM) < AMOUNT_EPS;
}

interface ParsedHit {
  ref: string;
  kindHint: "DeadManSwitch" | "MultiSig" | "unknown";
  payment: WalletPayment;
}

function extractHits(payments: WalletPayment[]): ParsedHit[] {
  const hits: ParsedHit[] = [];
  for (const p of payments) {
    if (p.kind !== "receive") continue;

    const textRef = parseVaultMemoText(p.memo);
    if (textRef) {
      hits.push({
        ref: textRef,
        kindHint: isVaultIdRef(textRef)
          ? "DeadManSwitch"
          : isContractRef(textRef)
            ? "MultiSig"
            : "unknown",
        payment: p,
      });
      continue;
    }

    // Multi-Sig wire format: MEMO_HASH + 0.0001 XLM notify amount.
    if (
      (p.memo_type === "hash" || p.memo_type === "HASH") &&
      amountLooksLikeNotify(p.amount)
    ) {
      const cid = contractIdFromMemoHash(p.memo);
      if (cid) {
        hits.push({ ref: cid, kindHint: "MultiSig", payment: p });
      }
    }
  }
  return hits;
}

async function hydrateDms(
  walletPublicKey: string,
  vaultId: bigint,
  payment: WalletPayment,
  prior?: DiscoveredVaultRecord,
): Promise<DiscoveredVaultRecord | null> {
  const onChain = await getAdvancedVault(walletPublicKey, vaultId);
  if (!onChain) return null;
  if (onChain.kind !== "DeadManSwitch") return null;
  // Must be the designated backup — not the owner rediscovering their own vault.
  if (onChain.backupAddress !== walletPublicKey) return null;
  if (onChain.owner === walletPublicKey) return null;

  const key = `dms:${vaultId.toString()}`;
  return {
    key,
    kind: "DeadManSwitch",
    role: "beneficiary",
    ref: vaultId.toString(),
    logicalMemo: formatVaultMemo(vaultId.toString()),
    counterparty: payment.counterparty || onChain.owner,
    txHash: payment.tx_hash,
    discoveredAt: prior?.discoveredAt ?? (payment.timestamp * 1000 || Date.now()),
    isNew: prior ? prior.isNew : true,
    name: onChain.name || `Dead Man's Switch #${vaultId.toString()}`,
    owner: onChain.owner,
    balanceXlm: stroopsToFloat(onChain.balance),
    pendingApproval: false,
    advanced: { ...onChain, isBeneficiary: true },
  };
}

async function hydrateMultiSig(
  walletPublicKey: string,
  contractId: string,
  payment: WalletPayment,
  prior?: DiscoveredVaultRecord,
): Promise<DiscoveredVaultRecord | null> {
  const native = await getMultiSigVault(walletPublicKey, contractId);
  if (!native) return null;

  const owner = String(native.owner ?? "");
  const coSigner = String(
    native.co_signer ?? native.cosigner ?? native.coSigner ?? "",
  );
  const isCoSigner = coSigner === walletPublicKey;
  const isOwner = owner === walletPublicKey;
  if (!isCoSigner && !isOwner) return null;

  // Owner already tracks via multi-sig-store; discovery focuses on co-signer.
  // Still index owner rediscoveries so a wiped local store can recover via memo.
  if (isOwner && !isCoSigner) {
    await upsertMultiSigEntry(walletPublicKey, {
      contractId,
      role: "owner",
      counterparty: coSigner || payment.counterparty,
      createdAt: prior?.discoveredAt ?? Date.now(),
      isNew: false,
    });
    return null;
  }

  let pendingApproval = false;
  try {
    const req = await getMultiSigWithdrawalRequest(walletPublicKey, contractId);
    if (req && typeof req === "object") {
      const approved = Boolean(
        req.approved ?? req.is_approved ?? req.co_signer_approved ?? false,
      );
      const amount = BigInt(String(req.amount ?? "0"));
      pendingApproval = amount > 0n && !approved;
    }
  } catch {
    /* best-effort */
  }

  const balance = BigInt(String(native.balance ?? native.amount ?? "0"));
  const key = `msig:${contractId}`;

  await upsertMultiSigEntry(walletPublicKey, {
    contractId,
    role: "co_signer",
    counterparty: owner || payment.counterparty,
    createdAt: prior?.discoveredAt ?? Date.now(),
    isNew: prior ? prior.isNew : true,
  });

  return {
    key,
    kind: "MultiSig",
    role: "co_signer",
    ref: contractId,
    logicalMemo: formatVaultMemo(contractId),
    counterparty: payment.counterparty || owner,
    txHash: payment.tx_hash,
    discoveredAt: prior?.discoveredAt ?? (payment.timestamp * 1000 || Date.now()),
    isNew: prior ? prior.isNew : true,
    name: "Multi-Sig Vault",
    owner,
    balanceXlm: stroopsToFloat(balance),
    pendingApproval,
  };
}

/**
 * Scan Horizon for vault memos, hydrate on-chain, merge into local cache.
 * Returns the full discovered list for this wallet (including previously cached).
 *
 * Deduped: concurrent callers (UnifiedVaultsList scanMemos, the
 * useDiscoveredVaults auto-scan, and listAdvancedVaults' internal discovery)
 * share one in-flight scan per wallet, and repeat scans within
 * MEMO_SCAN_COOLDOWN_MS return the last persisted result instead of
 * re-hitting Horizon (previously up to 3 scans × 200 memo lookups per load).
 * The in-memory dedupe state is cleared on disconnect only.
 */
const MEMO_SCAN_COOLDOWN_MS = 60_000;
const memoScansInFlight = new Map<string, Promise<DiscoveredVaultRecord[]>>();
const memoScanLastAt = new Map<string, number>();

export async function discoverVaultsFromMemos(
  walletPublicKey: string,
): Promise<DiscoveredVaultRecord[]> {
  const inflight = memoScansInFlight.get(walletPublicKey);
  if (inflight) return inflight;

  const lastAt = memoScanLastAt.get(walletPublicKey) ?? 0;
  if (Date.now() - lastAt < MEMO_SCAN_COOLDOWN_MS) {
    const file = await readCache();
    return file.byWallet[walletPublicKey]?.vaults ?? [];
  }

  const scan = scanMemosUncached(walletPublicKey);
  memoScansInFlight.set(walletPublicKey, scan);
  try {
    const result = await scan;
    memoScanLastAt.set(walletPublicKey, Date.now());
    return result;
  } finally {
    memoScansInFlight.delete(walletPublicKey);
  }
}

/** Drop the per-wallet in-memory scan dedupe. Called on wallet disconnect only. */
export function clearMemoDiscoveryScanCache(walletPublicKey: string): void {
  memoScansInFlight.delete(walletPublicKey);
  memoScanLastAt.delete(walletPublicKey);
}

async function scanMemosUncached(
  walletPublicKey: string,
): Promise<DiscoveredVaultRecord[]> {
  const file = await readCache();
  const priorSlot = file.byWallet[walletPublicKey];
  const priorByKey = new Map(
    (priorSlot?.vaults ?? []).map((v) => [v.key, v] as const),
  );

  let payments: WalletPayment[] = [];
  try {
    payments = await fetchWalletPayments(walletPublicKey, SCAN_LIMIT);
  } catch {
    return priorSlot?.vaults ?? [];
  }

  const hits = extractHits(payments);
  const nextByKey = new Map(priorByKey);

  for (const hit of hits) {
    try {
      if (hit.kindHint === "DeadManSwitch" || isVaultIdRef(hit.ref)) {
        const key = `dms:${hit.ref}`;
        const row = await hydrateDms(
          walletPublicKey,
          BigInt(hit.ref),
          hit.payment,
          priorByKey.get(key),
        );
        if (row) nextByKey.set(row.key, row);
      } else if (hit.kindHint === "MultiSig" || isContractRef(hit.ref)) {
        const key = `msig:${hit.ref}`;
        const row = await hydrateMultiSig(
          walletPublicKey,
          hit.ref,
          hit.payment,
          priorByKey.get(key),
        );
        if (row) nextByKey.set(row.key, row);
      }
    } catch {
      /* skip bad hit */
    }
  }

  const vaults = Array.from(nextByKey.values()).sort(
    (a, b) => b.discoveredAt - a.discoveredAt,
  );

  file.byWallet[walletPublicKey] = {
    scannedAt: Date.now(),
    cursorTxHash: payments[0]?.tx_hash,
    vaults,
  };
  await writeCache(file);
  return vaults;
}

/**
 * Convert discovered DMS rows into AdvancedVaultRecord[] for the existing
 * Advanced Vaults UI (beneficiary pills / claim actions).
 */
export function discoveredDmsAsAdvanced(
  discovered: DiscoveredVaultRecord[],
): AdvancedVaultRecord[] {
  return discovered
    .filter((d) => d.kind === "DeadManSwitch" && d.advanced)
    .map((d) => d.advanced!);
}

/**
 * Load Multi-Sig entries (owned + discovered) for management UI.
 */
export async function listKnownMultiSig(
  walletPublicKey: string,
): Promise<MultiSigEntry[]> {
  return listMultiSigEntries(walletPublicKey);
}

/** @deprecated Use listKnownMultiSig */
export const listKnownDualApproval = listKnownMultiSig;
