// Address Book — persisted contact list with optional default memo.
//
// The live key is xlm_vault_address_book_v1. storage.getItem already
// JSON.parses, and older builds sometimes stored the array itself.
// A second JSON.parse on that array throws, which made Smart address
// book look empty while the contacts were still on the phone.
// A seed-sealed blob in the same key is opened with decryptBackup
// (SHA-256, then SHA-1). Nothing here reads the phone's contacts.

import { unlockedWalletSeed } from "@/src/security/session-keystore";
import { storage } from "@/src/utils/storage";
import {
  openStoredAddressBook,
  parseAddressBookValue,
} from "@/src/wallet/address-book-parse";

export { openStoredAddressBook, parseAddressBookValue };

const ADDRESS_BOOK_KEY = "xlm_vault_address_book_v1";

// Simple mutex to prevent concurrent read-modify-write races when
// upsertEntry or removeEntry is called in quick succession. The
// underlying storage (AsyncStorage) is not transactional, so two
// concurrent callers could both read the same state before either
// writes, causing one update to silently overwrite the other.
let writeLock: Promise<void> | null = null;
let releaseLock: (() => void) | null = null;

async function acquireWriteLock(): Promise<void> {
  while (writeLock) {
    await writeLock;
  }
  writeLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
}

function releaseWriteLock(): void {
  const r = releaseLock;
  writeLock = null;
  releaseLock = null;
  r?.();
}

export type AddressBookKind = "private" | "exchange" | "casino" | "donation";

/**
 * Network tag on address-book entries.
 *
 * The Buy XLM (SOL→XLM) swap flow needs to keep Solana destination /
 * refund addresses separate from Stellar contacts. Same storage,
 * different indices — filter by `network` at read time.
 */
export type AddressBookNetwork = "stellar" | "solana";

/** Feather icon name stored on a contact (optional). */
export type AddressBookIcon = string;

export interface AddressBookEntry {
  id: string;
  label: string;
  publicKey: string;
  /**
   * Stellar memo (text, max 28 bytes). When the user picks this entry on
   * the Send screen, the memo input is pre-populated. Exchange / casino
   * entries typically carry a non-empty memo (deposit id); private
   * wallets typically leave this blank.
   */
  defaultMemo: string;
  kind: AddressBookKind;
  /** Optional — defaults to `"stellar"`. */
  network?: AddressBookNetwork;
  /**
   * Optional Feather icon name shown on contact cards. When absent,
   * UI falls back to the first letter of the label.
   */
  icon?: AddressBookIcon;
  createdAt: number;
  /**
   * Set on every write (create + edit). The
   * Google Drive backup merge uses this for LWW conflict resolution
   * so a stale remote entry (older `createdAt`) can no longer clobber
   * a locally-edited contact. When this field is `undefined` the
   * merge falls back to `createdAt`.
   */
  updatedAt?: number;
}

/** Backwards-compatible network resolver — old entries are Stellar. */
export function entryNetwork(e: AddressBookEntry): AddressBookNetwork {
  return e.network ?? "stellar";
}

/** Stellar G... address shape — 56 chars Base32, no 0/1/8/I/L. */
const STELLAR_G_REGEX = /^G[A-Z2-7]{55}$/;
/**
 * Solana address — Base58, 32-44 characters. We use a lenient check
 * (character class + length) rather than a full Base58 decode; the
 * SimpleSwap API is the source of truth and will reject malformed
 * addresses server-side.
 */
const SOLANA_ADDR_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Stellar Memo.text upper bound — 28 bytes UTF-8. */
const MEMO_BYTE_LIMIT = 28;

export function isValidStellarAddress(s: string): boolean {
  return STELLAR_G_REGEX.test(s.trim());
}

export function isValidSolanaAddress(s: string): boolean {
  return SOLANA_ADDR_REGEX.test(s.trim());
}

/**
 * Network-aware address validation. Solana entries bypass the G-prefix
 * check; Stellar entries continue to enforce the strict shape.
 */
export function isValidAddressForNetwork(
  s: string,
  network: AddressBookNetwork,
): boolean {
  return network === "solana"
    ? isValidSolanaAddress(s)
    : isValidStellarAddress(s);
}

export function isValidMemo(s: string): boolean {
  const trimmed = (s ?? "").trim();
  if (trimmed.length === 0) return true; // memo is optional
  // Byte-length, not codepoint length, is the Stellar protocol cap.
  try {
    const bytes = new TextEncoder().encode(trimmed).length;
    return bytes <= MEMO_BYTE_LIMIT;
  } catch {
    // Fall back to UTF-16 codepoint length × 4 worst-case if TextEncoder
    // isn't available (very old Hermes builds).
    return trimmed.length <= MEMO_BYTE_LIMIT;
  }
}

/** Read the complete address book without filtering. Does not rewrite the key. */
async function readAll(): Promise<AddressBookEntry[]> {
  const raw = await storage.getItem<unknown>(ADDRESS_BOOK_KEY, null);
  return openStoredAddressBook(raw, unlockedWalletSeed());
}

async function writeAll(entries: AddressBookEntry[]): Promise<void> {
  const saved = await storage.setItem(ADDRESS_BOOK_KEY, JSON.stringify(entries));
  if (!saved) throw new Error("Unable to save the address book.");
}

export async function listEntries(
  network?: AddressBookNetwork,
): Promise<AddressBookEntry[]> {
  const entries = await readAll();
  // Defensive: sort newest first so the picker UI feels predictable.
  // Also filter by network when requested; unknown
  // network entries default to `stellar` for legacy safety.
  // NOTE: We no longer filter by isValidAddressForNetwork here because
  // doing so would silently drop Solana entries from the Drive backup
  // envelope (buildEnvelope calls listEntries with no network filter).
  // Entries are validated at upsert time; reading them back should
  // return whatever was persisted.
  return entries
    .filter((e) => e && typeof e.publicKey === "string")
    .filter((e) => (network ? entryNetwork(e) === network : true))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Look up a saved contact by exact public key match.
 *
 * Used by the wallet-book's add/import flow to recognise an address
 * the user has already saved a nickname for from a previous session
 * (e.g. their own exchange deposit wallet, saved here as a contact
 * before it was ever imported as a signing wallet) — so onboarding
 * can offer that name back instead of prompting from scratch.
 *
 * If more than one contact row shares the same public key (different
 * memo/kind rows are allowed), the most recently touched one wins.
 */
export async function findEntryByPublicKey(
  publicKey: string,
  network?: AddressBookNetwork,
): Promise<AddressBookEntry | null> {
  const cleanPublicKey = (publicKey ?? "").trim();
  if (!cleanPublicKey) return null;
  const entries = await readAll();
  const candidates = entries.filter(
    (e) =>
      e &&
      typeof e.publicKey === "string" &&
      e.publicKey === cleanPublicKey &&
      (network ? entryNetwork(e) === network : true),
  );
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  )[0];
}

function newId(): string {
  // Lightweight non-crypto id; address-book entries are user-local and
  // don't need uuid-level uniqueness.
  return `ab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function upsertEntry(
  input: Omit<AddressBookEntry, "id" | "createdAt"> & { id?: string },
): Promise<AddressBookEntry> {
  const cleanPublicKey = input.publicKey.trim();
  const network: AddressBookNetwork = input.network ?? "stellar";
  if (!isValidAddressForNetwork(cleanPublicKey, network)) {
    throw new Error(
      network === "solana"
        ? "Public key is not a valid Solana address (32-44 Base58 chars)."
        : "Public key is not a valid 56-character Stellar address.",
    );
  }
  // Memo only applies to Stellar entries; Solana has no on-chain memo
  // primitive in the sense we use here, so we silently drop any memo
  // passed for a Solana entry.
  const memo = network === "solana" ? "" : (input.defaultMemo ?? "").trim();
  if (network === "stellar" && !isValidMemo(memo)) {
    throw new Error(`Memo exceeds the Stellar 28-byte text limit.`);
  }
  // Exchange / casino deposit addresses on Stellar REQUIRE a memo —
  // without one the receiving platform cannot credit the deposit.
  // Private wallet + donation keep memo optional. Solana is unaffected.
  if (
    network === "stellar" &&
    (input.kind === "exchange" || input.kind === "casino") &&
    memo.length === 0
  ) {
    throw new Error(
      "A memo is required for exchange and casino contacts. Paste the deposit memo from the platform.",
    );
  }
  const label = (input.label ?? "").trim();
  if (label.length === 0) throw new Error("Label is required.");
  if (label.length > 32) throw new Error("Label must be 32 characters or fewer.");

  await acquireWriteLock();
  try {
    // Read the unfiltered book so an unrelated edit can never drop a legacy
    // row merely because it fails current display validation.
    const all = await readAll();
    const now = Date.now();
    if (input.id) {
      const idx = all.findIndex((e) => e.id === input.id);
      if (idx >= 0) {
        const updated: AddressBookEntry = {
          ...all[idx],
          label,
          publicKey: cleanPublicKey,
          defaultMemo: memo,
          kind: input.kind,
          network,
          icon: input.icon || undefined,
          updatedAt: now,
        };
        all[idx] = updated;
        await writeAll(all);
        return updated;
      }
    }
    // Prevent silent duplicates — same publicKey + same memo + same network collides.
    const existing = all.find(
      (e) =>
        e.publicKey === cleanPublicKey &&
        e.defaultMemo === memo &&
        entryNetwork(e) === network,
    );
    if (existing) {
      existing.label = label;
      existing.kind = input.kind;
      existing.network = network;
      // Preserve icon unless the caller explicitly set one (AddressBookPicker
      // does not pass icon and must not wipe a previously chosen glyph).
      if (input.icon) existing.icon = input.icon;
      existing.updatedAt = now;
      await writeAll(all);
      return existing;
    }
    const created: AddressBookEntry = {
      id: newId(),
      label,
      publicKey: cleanPublicKey,
      defaultMemo: memo,
      kind: input.kind,
      network,
      icon: input.icon || undefined,
      createdAt: now,
      updatedAt: now,
    };
    await writeAll([created, ...all]);
    return created;
  } finally {
    releaseWriteLock();
  }
}

export async function removeEntry(id: string): Promise<void> {
  await acquireWriteLock();
  try {
    const all = await readAll();
    await writeAll(all.filter((e) => e.id !== id));
  } finally {
    releaseWriteLock();
  }
}

/** Test / debug helper — return the raw stored payload. */
export async function _debugReadRawCiphertext(): Promise<string> {
  return (await storage.getItem<string>(ADDRESS_BOOK_KEY, "")) ?? "";
}
