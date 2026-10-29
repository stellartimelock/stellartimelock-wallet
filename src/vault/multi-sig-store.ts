/**
 * Local registry of Multi-Sig vault contract ids.
 * Owned vaults are recorded at create time; discovered co-signer vaults
 * are merged in by memo-discovery. No backend.
 *
 * Storage key retained from the Dual Approval era so existing local indexes
 * keep working after the rename.
 */

import { storage } from "@/src/utils/storage";

const STORE_KEY = "xlm_vault_dual_approval_registry_v1";

export type MultiSigRole = "owner" | "co_signer";

export interface MultiSigEntry {
  contractId: string;
  role: MultiSigRole;
  /** Counterparty G-address when known (co-signer for owner, owner for co-signer). */
  counterparty?: string;
  createdAt: number;
  /** Soft badge — true until the user opens the vault. */
  isNew?: boolean;
}

interface RegistryFile {
  /** keyed by wallet public key → entries */
  byWallet: Record<string, MultiSigEntry[]>;
}

async function readFile(): Promise<RegistryFile> {
  const raw = await storage.getItem<RegistryFile>(STORE_KEY, { byWallet: {} });
  if (!raw || typeof raw !== "object" || !raw.byWallet) return { byWallet: {} };
  return raw;
}

async function writeFile(file: RegistryFile): Promise<void> {
  await storage.setItem(STORE_KEY, file);
}

export async function listMultiSigEntries(
  walletPublicKey: string,
): Promise<MultiSigEntry[]> {
  const file = await readFile();
  return file.byWallet[walletPublicKey] ?? [];
}

export async function upsertMultiSigEntry(
  walletPublicKey: string,
  entry: MultiSigEntry,
): Promise<void> {
  const file = await readFile();
  const list = file.byWallet[walletPublicKey] ?? [];
  const idx = list.findIndex((e) => e.contractId === entry.contractId);
  if (idx >= 0) {
    const prev = list[idx];
    list[idx] = {
      ...prev,
      ...entry,
      // Keep an existing "new" badge unless the caller explicitly clears it.
      isNew: entry.isNew === false ? false : prev.isNew || entry.isNew,
    };
  } else {
    list.push(entry);
  }
  file.byWallet[walletPublicKey] = list;
  await writeFile(file);
}

export async function markMultiSigSeen(
  walletPublicKey: string,
  contractId: string,
): Promise<void> {
  const file = await readFile();
  const list = file.byWallet[walletPublicKey] ?? [];
  let changed = false;
  for (const e of list) {
    if (e.contractId === contractId && e.isNew) {
      e.isNew = false;
      changed = true;
    }
  }
  if (changed) {
    file.byWallet[walletPublicKey] = list;
    await writeFile(file);
  }
}

export async function removeMultiSigEntry(
  walletPublicKey: string,
  contractId: string,
): Promise<void> {
  const file = await readFile();
  const list = file.byWallet[walletPublicKey] ?? [];
  file.byWallet[walletPublicKey] = list.filter((e) => e.contractId !== contractId);
  await writeFile(file);
}

/** G… addresses saved next to a vault. Contract ids are not payment addresses. */
export async function listVaultCounterpartyAddresses(): Promise<
  { id: string; label: string; publicKey: string }[]
> {
  const file = await readFile();
  const out: { id: string; label: string; publicKey: string }[] = [];
  for (const entries of Object.values(file.byWallet)) {
    for (const entry of entries) {
      const publicKey = (entry.counterparty ?? "").trim();
      if (!/^G[A-Z2-7]{55}$/.test(publicKey)) continue;
      out.push({
        id: `vault_${entry.contractId}`,
        label: "Vault",
        publicKey,
      });
    }
  }
  return out;
}

/** @deprecated Use listMultiSigEntries — alias for older imports. */
export const listDualApprovalEntries = listMultiSigEntries;
/** @deprecated Use upsertMultiSigEntry */
export const upsertDualApprovalEntry = upsertMultiSigEntry;
/** @deprecated Use markMultiSigSeen */
export const markDualApprovalSeen = markMultiSigSeen;
/** @deprecated Use removeMultiSigEntry */
export const removeDualApprovalEntry = removeMultiSigEntry;
/** @deprecated Use MultiSigEntry */
export type DualApprovalEntry = MultiSigEntry;
/** @deprecated Use MultiSigRole */
export type DualApprovalRole = MultiSigRole;
