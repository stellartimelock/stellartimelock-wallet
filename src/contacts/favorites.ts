// Phone favorites for the send chooser.
//
// Starred contacts come from Android's ContactsContract.STARRED — the
// same list other apps use. A Stellar address and optional memo live on
// that contact as one custom data row. This module only decides how those
// rows line up with the wallet address book. It does not read seeds or keys.

export const STELLAR_ADDRESS_MIME =
  "vnd.android.cursor.item/vnd.com.stellartimelock.address";

const PUBLIC_ADDRESS = /^G[A-Z2-7]{55}$/;
const SECRET_KEY = /^S[A-Z2-7]{55}$/;
const MEMO_BYTE_LIMIT = 28;

export type WalletContactKind = "private" | "exchange" | "casino" | "donation";

/** Structural slice of an address-book entry. Extra fields are ignored. */
export interface WalletContact {
  id: string;
  label: string;
  publicKey: string;
  defaultMemo: string;
  kind: WalletContactKind;
  network?: "stellar" | "solana";
}

export interface PhoneContactRow {
  contactId: string;
  displayName: string;
  starred: boolean;
  address: string | null;
  memo: string | null;
}

export interface FavoriteSendRow {
  contactId: string;
  displayName: string;
  /** Public G... address, or null when the favorite has none yet. */
  address: string | null;
  memo: string;
  /** Wallet address-book row for this address and memo, when one exists. */
  entry: WalletContact | null;
}

export interface AddressUpsert {
  label: string;
  publicKey: string;
  defaultMemo: string;
  kind: "private";
  network: "stellar";
}

export function isStellarPublicAddress(value: string): boolean {
  return PUBLIC_ADDRESS.test(value.trim());
}

/** Public G... addresses only. Secret keys and seed phrases are refused. */
export function assertPublicStellarAddress(value: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.includes(" ") || SECRET_KEY.test(trimmed)) {
    throw new Error("Only a public Stellar address (G...) can be saved on a contact.");
  }
  if (!PUBLIC_ADDRESS.test(trimmed)) {
    throw new Error("Address must be a 56-character Stellar address starting with G.");
  }
  return trimmed;
}

export function normalizeMemo(value: string | null | undefined): string {
  const memo = (value ?? "").trim();
  if (memo.length === 0) return "";
  if (new TextEncoder().encode(memo).length > MEMO_BYTE_LIMIT) {
    throw new Error("Memo exceeds the Stellar 28-byte text limit.");
  }
  return memo;
}

export function favoriteLabel(displayName: string): string {
  const trimmed = (displayName ?? "").trim().replace(/\s+/g, " ");
  const base = trimmed.length > 0 ? trimmed : "Favorite";
  return base.length > 32 ? base.slice(0, 32) : base;
}

export function linkKey(publicKey: string, memo: string): string {
  return `${publicKey}\n${memo}`;
}

function cleanAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return PUBLIC_ADDRESS.test(trimmed) ? trimmed : null;
}

function cleanMemo(value: string | null | undefined): string {
  const memo = (value ?? "").trim();
  if (memo.length === 0) return "";
  try {
    return new TextEncoder().encode(memo).length <= MEMO_BYTE_LIMIT ? memo : "";
  } catch {
    return memo.length <= MEMO_BYTE_LIMIT ? memo : "";
  }
}

function isStellarBookEntry(entry: WalletContact): boolean {
  return (entry.network ?? "stellar") === "stellar";
}

/**
 * Favorites first, in the phone's order. Address-book rows that match a
 * favorite (same public key and memo) are not repeated underneath.
 * A starred contact with no public address stays in the favorites row so
 * the user can save one.
 */
export function partitionRecipients(
  phone: PhoneContactRow[],
  book: WalletContact[],
): { favorites: FavoriteSendRow[]; addressBook: WalletContact[] } {
  const stellarBook = book.filter(isStellarBookEntry);
  const favorites: FavoriteSendRow[] = [];
  const usedIds = new Set<string>();
  const seenContacts = new Set<string>();

  for (const contact of phone) {
    if (!contact.starred) continue;
    const contactId = (contact.contactId ?? "").trim();
    if (!contactId || seenContacts.has(contactId)) continue;
    seenContacts.add(contactId);
    const address = cleanAddress(contact.address);
    const memo = address ? cleanMemo(contact.memo) : "";
    const entry = address
      ? stellarBook.find(
          (row) => row.publicKey === address && (row.defaultMemo ?? "") === memo,
        ) ?? null
      : null;
    if (entry) usedIds.add(entry.id);
    favorites.push({
      contactId,
      displayName: (contact.displayName ?? "").trim() || "Unnamed",
      address,
      memo,
      entry,
    });
  }

  return {
    favorites,
    addressBook: stellarBook.filter((row) => !usedIds.has(row.id)),
  };
}

/**
 * New wallet address-book rows for starred contacts that already have a
 * public address. Existing rows are left alone so a nickname or kind the
 * user set in the wallet is not replaced.
 */
export function planAddressBookSync(
  phone: PhoneContactRow[],
  book: WalletContact[],
): AddressUpsert[] {
  const plans: AddressUpsert[] = [];
  const seen = new Set<string>();
  for (const contact of phone) {
    if (!contact.starred) continue;
    const publicKey = cleanAddress(contact.address);
    if (!publicKey) continue;
    const memo = cleanMemo(contact.memo);
    const key = linkKey(publicKey, memo);
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = book.find(
      (row) =>
        isStellarBookEntry(row) &&
        row.publicKey === publicKey &&
        (row.defaultMemo ?? "") === memo,
    );
    if (existing) continue;
    plans.push({
      label: favoriteLabel(contact.displayName),
      publicKey,
      defaultMemo: memo,
      kind: "private",
      network: "stellar",
    });
  }
  return plans;
}

export function linksFromSaved(saved: PhoneContactRow[]): Record<string, string> {
  const links: Record<string, string> = {};
  for (const row of saved) {
    const contactId = (row.contactId ?? "").trim();
    const address = cleanAddress(row.address);
    if (!contactId || !address) continue;
    links[linkKey(address, cleanMemo(row.memo))] = contactId;
  }
  return links;
}

export async function syncStarredFavorites(input: {
  starred: PhoneContactRow[];
  listBook: () => Promise<WalletContact[]>;
  upsert: (row: AddressUpsert) => Promise<void>;
}): Promise<{ favorites: FavoriteSendRow[]; addressBook: WalletContact[]; changed: boolean }> {
  const book = await input.listBook();
  const plans = planAddressBookSync(input.starred, book);
  let changed = false;
  for (const plan of plans) {
    try {
      await input.upsert(plan);
      changed = true;
    } catch {
      // One refused row does not stop the rest of the favorites from syncing.
    }
  }
  const nextBook = changed ? await input.listBook() : book;
  return { ...partitionRecipients(input.starred, nextBook), changed };
}

/**
 * Without contacts permission the phone is not queried. The wallet address
 * book is the whole recipient list.
 */
export async function loadRecipients(
  permission: "granted" | "denied" | "unavailable",
  deps: {
    listStarred: () => Promise<PhoneContactRow[]>;
    listBook: () => Promise<WalletContact[]>;
    upsert: (row: AddressUpsert) => Promise<void>;
  },
): Promise<{ favorites: FavoriteSendRow[]; addressBook: WalletContact[]; usedPhone: boolean }> {
  if (permission !== "granted") {
    const book = await deps.listBook();
    return {
      favorites: [],
      addressBook: book.filter(isStellarBookEntry),
      usedPhone: false,
    };
  }
  try {
    const starred = await deps.listStarred();
    const loaded = await syncStarredFavorites({
      starred,
      listBook: deps.listBook,
      upsert: deps.upsert,
    });
    return { ...loaded, usedPhone: true };
  } catch {
    const book = await deps.listBook();
    return {
      favorites: [],
      addressBook: book.filter(isStellarBookEntry),
      usedPhone: false,
    };
  }
}
