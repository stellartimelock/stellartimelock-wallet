// Wallet backup envelope logic — build + apply + restore helpers.
//
// Ported from the unified app's shared envelope with the
// productivity-only categories (notes, bills, ledger, ledger slots,
// home layout, folder meta) removed. The wallet app backs up:
//   • Address book (contacts)
//   • TOTP entries
//   • Key Manager entries (manually saved secret seeds)
//   • Wallet metadata (nicknames)
//   • Display currency (prefs.currency; older files simply omit it)
//
// The active wallet secret seed / key material is NEVER included in
// the envelope — it lives in SecureStore independently. Key Manager
// entries are user-curated extras and ARE included in the backup.
//
// When the envelope is at rest on disk (the .stvault / .os file), it is
// AES-256 encrypted via src/security/crypto.ts. The key comes from the
// Stellar secret seed, so the same seed opens the file on a new phone.
// New files are ciphertext v3. v1 (two-part) and v2 still decrypt.

import { detectEncryptedFormat } from "@/src/security/crypto";
import {
  listKeyEntries,
  removeKeyEntry,
  syncKeyManagerLabelForPublicKey,
  upsertKeyEntry,
  type KeyManagerEntry,
} from "@/src/security/key-manager-store";
import { listEntries, upsertEntry, removeEntry, type AddressBookEntry } from "@/src/wallet/address-book";
import {
  listTotpEntries,
  removeTotpEntry,
  upsertTotpEntry,
  type TotpEntry,
} from "@/src/security/totp/store";
import {
  loadBook,
  writeBook,
  type WalletMeta,
} from "@/src/wallet/wallet-book";
import { moneySectionPresent } from "@/src/utils/save-compat";
import {
  isDisplayCurrency,
  readDisplayCurrency,
  type DisplayCurrency,
} from "@/src/state/currency-pref";

// v8 adds keyManager (saved keys). v7 added walletMeta (nicknames).
// We accept v1–v8 on restore for backward compatibility.
export interface BackupEnvelope {
  v: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  writtenAt: number;
  device: string;
  notes: Array<{ id: string; updatedAt?: number }>;
  bills: Array<{ id: string; createdAt?: number }>;
  addresses: AddressBookEntry[];
  ledger?: Array<{ id: string; updatedAt?: number }>;
  ledgerSlots?: Array<{ id: string; updatedAt?: number; createdAt?: number }>;
  totp?: TotpEntry[];
  keyManager?: KeyManagerEntry[];
  walletMeta?: WalletMeta[];
  /**
   * Optional money document from builds that had Assistant and Bills.
   * 1.6.4 does not import it. Reading it must not throw.
   */
  money?: unknown;
  prefs?: {
    /** Display currency (USD, EUR or XLM). Optional: files before 1.6.20 omit it. */
    currency?: DisplayCurrency;
    homeLayout?: string[];
    folderMeta?: Record<string, unknown>;
    sectionOrder?: string[];
    collapseState?: Record<string, boolean>;
  };
}

export interface ApplyEnvelopeResult {
  notes: number;
  bills: number;
  addresses: number;
  ledger: number;
  ledgerSlots?: number;
  totp?: number;
  keys?: number;
  wallets?: number;
  homeLayout?: number;
  /** Display currency from the backup, when the file has one. The caller applies it. */
  currency?: DisplayCurrency;
}

/**
 * Build the current envelope snapshot from the local wallet stores.
 * Each store category is individually caught so a failure in one
 * never prevents the rest from being backed up.
 */
export async function buildEnvelope(): Promise<BackupEnvelope> {
  const [addresses] = await Promise.all([
    listEntries().catch(() => [] as AddressBookEntry[]),
  ]);
  let totp: TotpEntry[] | undefined;
  try {
    totp = await listTotpEntries();
  } catch {
    totp = undefined;
  }
  let keyManager: KeyManagerEntry[] | undefined;
  try {
    keyManager = await listKeyEntries();
  } catch {
    keyManager = undefined;
  }
  let walletMeta: WalletMeta[] | undefined;
  try {
    const book = await loadBook();
    walletMeta = book.entries.length > 0 ? book.entries : undefined;
  } catch {
    walletMeta = undefined;
  }
  // Display currency rides along so a restore brings it back. The
  // envelope version stays 8: older apps ignore prefs, so their files and
  // ours stay importable both ways.
  const currency = await readDisplayCurrency();

  // Money and bills are no longer written. Older files that still
  // carry a money document are left untouched on disk.

  // Reconcile nicknames across wallet-book ↔ Key Manager so the
  // .stvault file never ships divergent labels for the same pubkey.
  // Persist the winner locally so the two UIs stay aligned after export.
  if (walletMeta && walletMeta.length > 0 && keyManager && keyManager.length > 0) {
    const kmByPub = new Map(
      keyManager.map((k) => [k.publicAddress.toUpperCase(), k]),
    );
    let bookDirty = false;
    let keysDirty = false;
    for (const w of walletMeta) {
      const km = kmByPub.get(w.publicKey.toUpperCase());
      if (!km) continue;
      const wTs = w.updatedAt ?? w.createdAt ?? 0;
      const kTs = km.updatedAt ?? km.createdAt ?? 0;
      if (w.label === km.label) continue;
      if (wTs >= kTs) {
        km.label = w.label;
        km.updatedAt = Math.max(wTs, kTs);
        keysDirty = true;
      } else {
        w.label = km.label;
        w.updatedAt = Math.max(wTs, kTs);
        bookDirty = true;
      }
    }
    if (bookDirty) {
      try {
        const book = await loadBook();
        const byPub = new Map(walletMeta.map((w) => [w.publicKey, w]));
        for (const e of book.entries) {
          const w = byPub.get(e.publicKey);
          if (w && e.label !== w.label) {
            e.label = w.label;
            e.updatedAt = w.updatedAt;
          }
        }
        await writeBook(book);
      } catch {
        /* non-fatal */
      }
    }
    if (keysDirty) {
      for (const km of keyManager) {
        try {
          await syncKeyManagerLabelForPublicKey(km.publicAddress, km.label);
        } catch {
          /* non-fatal */
        }
      }
    }
  }

  return {
    v: 8,
    writtenAt: Date.now(),
    device: "stellar-timelock-wallet",
    notes: [],
    bills: [],
    addresses,
    totp,
    keyManager,
    walletMeta,
    ...(currency ? { prefs: { currency } } : {}),
  };
}

/**
 * Empty-envelope guard.
 *
 * Returns true when the envelope carries zero wallet data across every
 * category we back up. The caller uses this to block the "Back up
 * now" button — otherwise a first-launch user accidentally overwrites
 * their backup with an empty payload.
 */
export function isEnvelopeEmpty(env: BackupEnvelope): boolean {
  if (!env) return true;
  return (
    (env.addresses?.length ?? 0) === 0 &&
    (env.totp?.length ?? 0) === 0 &&
    (env.keyManager?.length ?? 0) === 0 &&
    (env.walletMeta?.length ?? 0) === 0 &&
    !moneySectionPresent(env.money, env.bills)
  );
}

/**
 * Apply an envelope to the local stores via last-writer-wins merge.
 * Notes, the ledger, and the old money/bills document stay out.
 * A money field is ignored. It does not throw and it does not wipe
 * the address book, keys, or wallet nicknames.
 */
export function isSupportedEnvelopeVersion(v: unknown): v is BackupEnvelope["v"] {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5 || v === 6 || v === 7 || v === 8;
}

export async function applyEnvelope(env: BackupEnvelope): Promise<ApplyEnvelopeResult> {
  if (!isSupportedEnvelopeVersion(env?.v)) {
    throw new Error("Backup file is malformed (unknown version).");
  }
  // Older files omit sections. A missing list is "not in this backup",
  // not "delete what is on the phone".
  const addressesPresent = Array.isArray(env.addresses);
  if (!addressesPresent) env.addresses = [];
  if (__DEV__) {
    console.time("[backup] applyEnvelope:total");
    console.log(
      `[backup] applyEnvelope v=${env.v}, addresses=${env.addresses.length}, totp=${(env.totp ?? []).length}, keys=${(env.keyManager ?? []).length}, wallets=${(env.walletMeta ?? []).length}`,
    );
  }

  // Merge address book (LWW by updatedAt)
  const addrTs = (a: AddressBookEntry): number =>
    (a as { updatedAt?: number }).updatedAt ?? a.createdAt ?? 0;
  const localAddrs = addressesPresent ? await listEntries() : [];
  const localAddrById = new Map(localAddrs.map((a) => [a.id, a]));
  const remoteAddrIds = new Set((addressesPresent ? env.addresses : []).map((a) => a.id));
  for (const ra of addressesPresent ? env.addresses : []) {
    const la = localAddrById.get(ra.id);
    if (!la || addrTs(ra) > addrTs(la)) {
      try {
        let network = ra.network;
        if (!network) {
          const publicKey = (ra.publicKey ?? "").trim();
          const isSolana = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(publicKey) &&
            !/^G[A-Z2-7]{55}$/.test(publicKey);
          network = isSolana ? "solana" : "stellar";
        }
        await upsertEntry({
          id: ra.id,
          label: ra.label,
          publicKey: ra.publicKey,
          defaultMemo: ra.defaultMemo,
          kind: ra.kind,
          network,
          icon: ra.icon,
        });
      } catch {
        /* skip invalid remote entries */
      }
    }
  }
  if (addressesPresent) {
    for (const la of localAddrs) {
      if (!remoteAddrIds.has(la.id)) {
        try { await removeEntry(la.id); } catch { /* non-fatal */ }
      }
    }
  }

  // Merge TOTP
  let totpCount: number | undefined;
  if (Array.isArray(env.totp)) {
    try {
      const localTotp = await listTotpEntries();
      const localTotpById = new Map(localTotp.map((t) => [t.id, t]));
      const remoteTotpIds = new Set(env.totp.map((t) => t.id));
      for (const rt of env.totp) {
        const lt = localTotpById.get(rt.id);
        if (!lt || (rt.updatedAt ?? 0) > (lt.updatedAt ?? 0)) {
          try {
            await upsertTotpEntry({
              id: rt.id,
              name: rt.name,
              issuer: rt.issuer,
              secret: rt.secret,
              isDefault: rt.isDefault,
            });
          } catch { /* skip */ }
        }
      }
      for (const lt of localTotp) {
        if (!remoteTotpIds.has(lt.id)) {
          try { await removeTotpEntry(lt.id); } catch { /* non-fatal */ }
        }
      }
      totpCount = env.totp.length;
    } catch {
      totpCount = 0;
    }
  }

  // Merge Key Manager entries (LWW by updatedAt / createdAt)
  let keysCount: number | undefined;
  if (Array.isArray(env.keyManager)) {
    try {
      const keyTs = (k: KeyManagerEntry): number =>
        k.updatedAt ?? k.createdAt ?? 0;
      const localKeys = await listKeyEntries();
      const localKeyById = new Map(localKeys.map((k) => [k.id, k]));
      const remoteKeyIds = new Set(env.keyManager.map((k) => k.id));
      for (const rk of env.keyManager) {
        const lk = localKeyById.get(rk.id);
        if (!lk || keyTs(rk) > keyTs(lk)) {
          try {
            await upsertKeyEntry(
              {
                id: rk.id,
                label: rk.label,
                secretSeed: rk.secretSeed,
                publicAddress: rk.publicAddress,
                seedPhrase: rk.seedPhrase,
                notes: rk.notes,
              },
              // The restore screen already confirmed replacing local data.
              { confirmShrink: true },
            );
          } catch { /* skip invalid remote entries */ }
        }
      }
      for (const lk of localKeys) {
        if (!remoteKeyIds.has(lk.id)) {
          try {
            await removeKeyEntry(lk.id, { confirmShrink: true });
          } catch { /* non-fatal */ }
        }
      }
      keysCount = env.keyManager.length;
    } catch {
      keysCount = 0;
    }
  }

  // Restore wallet nicknames from the backup onto matching local
  // wallets (matched by public key). Secrets are never in the
  // envelope — we only revive labels for wallets already on device.
  // Then mirror those labels into Key Manager so both UIs agree.
  let walletCount: number | undefined;
  if (Array.isArray(env.walletMeta) && env.walletMeta.length > 0) {
    try {
      const book = await loadBook();
      const remoteByKey = new Map(
        env.walletMeta.map((w) => [w.publicKey.toUpperCase(), w]),
      );
      let changed = false;
      for (const entry of book.entries) {
        const remote = remoteByKey.get(entry.publicKey.toUpperCase());
        if (!remote?.label) continue;
        if (
          entry.label !== remote.label ||
          (remote.updatedAt != null && entry.updatedAt !== remote.updatedAt)
        ) {
          entry.label = remote.label;
          entry.updatedAt =
            remote.updatedAt ?? remote.createdAt ?? Date.now();
          changed = true;
        }
      }
      if (changed) await writeBook(book);
      for (const entry of book.entries) {
        try {
          await syncKeyManagerLabelForPublicKey(entry.publicKey, entry.label);
        } catch {
          /* non-fatal */
        }
      }
      walletCount = env.walletMeta.length;
    } catch {
      walletCount = 0;
    }
  }

  // Assistant and Bills were removed. Ignore any money document.
  let billsApplied = 0;
  try {
    if (moneySectionPresent(env.money, env.bills)) billsApplied = 0;
  } catch {
    billsApplied = 0;
  }

  // Display currency (optional; missing in older files = leave as is).
  const prefCurrency = env.prefs?.currency;
  const currency = isDisplayCurrency(prefCurrency) ? prefCurrency : undefined;

  if (__DEV__) {
    console.timeEnd("[backup] applyEnvelope:total");
  }
  return {
    notes: 0,
    bills: billsApplied,
    addresses: env.addresses.length,
    ledger: 0,
    ledgerSlots: 0,
    totp: totpCount,
    keys: keysCount,
    wallets: walletCount,
    homeLayout: 0,
    currency,
  };
}

export function detectLocalCryptoFormat(cipher: string): 1 | 2 | 3 | null {
  return detectEncryptedFormat(cipher);
}