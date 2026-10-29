// Pure readers for xlm_vault_address_book_v1.
// No storage and no React Native, so a second JSON.parse on an
// already-parsed array can be tested without a device.

import { detectEncryptedFormat, decryptBackupAsync } from "@/src/security/backup-crypto";

export type ParsedAddressKind = "private" | "exchange" | "casino" | "donation";
export type ParsedAddressNetwork = "stellar" | "solana";

export interface ParsedAddressBookEntry {
  id: string;
  label: string;
  publicKey: string;
  defaultMemo: string;
  kind: ParsedAddressKind;
  network?: ParsedAddressNetwork;
  icon?: string;
  createdAt: number;
  updatedAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function when(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const KINDS = new Set<ParsedAddressKind>(["private", "exchange", "casino", "donation"]);

function rowsFromValue(value: unknown): unknown[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.replace(/^\uFEFF/, "").trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("\"")) {
      try {
        return rowsFromValue(JSON.parse(trimmed) as unknown);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (!isRecord(value)) return [];
  if (Array.isArray(value.addresses)) return value.addresses;
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.contacts)) return value.contacts;
  if (text(value.publicKey) || text(value.address) || text(value.gAddress)) return [value];
  return [];
}

function normalizeStoredContact(raw: unknown): ParsedAddressBookEntry | null {
  if (!isRecord(raw)) return null;
  const publicKey = text(raw.publicKey) || text(raw.address) || text(raw.gAddress) || text(raw.pubkey);
  if (!publicKey) return null;
  const label = text(raw.label) || text(raw.name) || text(raw.nickname) || "Saved contact";
  const createdAt = when(raw.createdAt);
  const kindText = text(raw.kind);
  const kind: ParsedAddressKind = KINDS.has(kindText as ParsedAddressKind)
    ? (kindText as ParsedAddressKind)
    : "private";
  const network: ParsedAddressNetwork = raw.network === "solana" ? "solana" : "stellar";
  return {
    id: text(raw.id) || `ab_${publicKey.slice(0, 12)}`,
    label,
    publicKey,
    defaultMemo: text(raw.defaultMemo) || text(raw.memo),
    kind,
    network,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    createdAt,
    updatedAt: when(raw.updatedAt, createdAt),
  };
}

/**
 * Turn whatever was stored under the address-book key into contacts.
 * Accepts a parsed array, a JSON string, an envelope's `addresses`
 * list, and older rows that used `name` / `address` / `memo`.
 */
export function parseAddressBookValue(value: unknown): ParsedAddressBookEntry[] {
  const out: ParsedAddressBookEntry[] = [];
  const seen = new Set<string>();
  for (const row of rowsFromValue(value)) {
    const entry = normalizeStoredContact(row);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/**
 * Open one stored value. A seed-sealed string is decrypted and not
 * written back. A locked seed or a seed that does not open the blob
 * returns an empty list. The caller keeps the original bytes.
 */
export async function openStoredAddressBook(
  raw: unknown,
  seed: string | null,
): Promise<ParsedAddressBookEntry[]> {
  if (raw == null || raw === "") return [];
  if (typeof raw === "string" && detectEncryptedFormat(raw)) {
    if (!seed) return [];
    const plain = await decryptBackupAsync(raw, seed);
    if (!plain) return [];
    return parseAddressBookValue(plain);
  }
  return parseAddressBookValue(raw);
}
