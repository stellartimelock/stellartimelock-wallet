// Key Manager at rest.
//
// The whole save is encrypted with the same seed-derived scheme as a
// .stvault / .os backup. New writes are ciphertext v3. v1 and v2 still
// open. A plaintext JSON array is the older save and is encrypted once
// the wallet seed is in memory.
//
// The plaintext copy is written before the live save is replaced, and
// deleted only after the encrypted copy opens back to the same keys.
// Nothing here is device-bound. A new phone with the same seed opens it.

import {
  decryptBackup,
  decryptBackupAsync,
  detectEncryptedFormat,
  encryptV3,
  encryptV3Async,
} from "@/src/security/backup-crypto";

export interface KeyManagerStoredEntry {
  id?: string;
  label?: string;
  chain?: string;
  watchOnly?: boolean;
  secretSeed?: string;
  publicAddress?: string;
  seedPhrase?: string;
  notes?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface MigrationIo {
  readLive: () => Promise<string>;
  writeLive: (payload: string) => Promise<void>;
  /** Must finish before writeLive. Keeps the first plaintext copy. */
  backupPlaintext: (json: string) => Promise<void>;
  removeBackup: () => Promise<void>;
}

export interface MigrationResult {
  entries: KeyManagerStoredEntry[];
  migrated: boolean;
  verified: boolean;
}

export function parseEntries(raw: string): KeyManagerStoredEntry[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as KeyManagerStoredEntry[]) : [];
  } catch {
    return [];
  }
}

/** A JSON array is the pre-encryption save. Ciphertext is v1, v2, or v3. */
export function isPlaintextKeyManagerPayload(raw: string): boolean {
  const text = unwrapStored(raw).trim();
  if (!text.startsWith("[")) return false;
  try {
    return Array.isArray(JSON.parse(text));
  } catch {
    return false;
  }
}

export function payloadHasPlaintextSecrets(raw: string): boolean {
  if (!isPlaintextKeyManagerPayload(raw)) return false;
  return parseEntries(unwrapStored(raw)).some(
    (entry) =>
      (typeof entry.secretSeed === "string" && entry.secretSeed.length > 0) ||
      (typeof entry.seedPhrase === "string" && entry.seedPhrase.length > 0),
  );
}

function unwrapStored(raw: string): string {
  let text = raw ?? "";
  for (let i = 0; i < 2; i++) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("\"")) break;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed !== "string") break;
      text = parsed;
    } catch {
      break;
    }
  }
  return text;
}

function sameEntries(left: KeyManagerStoredEntry[], right: KeyManagerStoredEntry[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if ((left[i].id ?? "") !== (right[i].id ?? "")) return false;
    if ((left[i].secretSeed ?? "") !== (right[i].secretSeed ?? "")) return false;
    if ((left[i].seedPhrase ?? "") !== (right[i].seedPhrase ?? "")) return false;
    if ((left[i].publicAddress ?? "") !== (right[i].publicAddress ?? "")) return false;
    if ((left[i].label ?? "") !== (right[i].label ?? "")) return false;
    if ((left[i].chain ?? "") !== (right[i].chain ?? "")) return false;
    if ((left[i].notes ?? "") !== (right[i].notes ?? "")) return false;
  }
  return true;
}

export function openKeyManagerPayload(
  raw: string,
  secretSeed: string,
): KeyManagerStoredEntry[] | null {
  const text = unwrapStored(raw).trim();
  if (!text) return [];
  if (isPlaintextKeyManagerPayload(text)) return parseEntries(text);
  if (detectEncryptedFormat(text) == null) return null;
  const plain = decryptBackup(text, secretSeed);
  if (!plain) return null;
  const entries = parseEntries(plain);
  if (!plain.trim().startsWith("[")) return null;
  return entries;
}

export function sealKeyManagerPayload(
  entries: KeyManagerStoredEntry[],
  secretSeed: string,
  iv: Uint8Array,
  salt: Uint8Array,
): string {
  return encryptV3(JSON.stringify(entries), secretSeed, iv, salt);
}

export async function openKeyManagerPayloadAsync(
  raw: string,
  secretSeed: string,
): Promise<KeyManagerStoredEntry[] | null> {
  const text = unwrapStored(raw).trim();
  if (!text) return [];
  if (isPlaintextKeyManagerPayload(text)) return parseEntries(text);
  if (detectEncryptedFormat(text) == null) return null;
  const plain = await decryptBackupAsync(text, secretSeed);
  if (!plain) return null;
  const entries = parseEntries(plain);
  if (!plain.trim().startsWith("[")) return null;
  return entries;
}

export async function sealKeyManagerPayloadAsync(
  entries: KeyManagerStoredEntry[],
  secretSeed: string,
  iv: Uint8Array,
  salt: Uint8Array,
): Promise<string> {
  return encryptV3Async(JSON.stringify(entries), secretSeed, iv, salt);
}

/**
 * Encrypt a plaintext save with the wallet seed.
 * If the copy cannot be written, the live save is left unchanged.
 * Already-encrypted saves are only opened. A wrong seed does not write.
 */
export async function runKeyManagerMigration(
  io: MigrationIo,
  secretSeed: string | null,
  randomBytes: () => Promise<Uint8Array>,
): Promise<MigrationResult> {
  const live = unwrapStored(await io.readLive());
  if (!live.trim()) return { entries: [], migrated: false, verified: true };

  if (!isPlaintextKeyManagerPayload(live)) {
    if (!secretSeed) return { entries: [], migrated: false, verified: false };
    const opened = await openKeyManagerPayloadAsync(live, secretSeed);
    if (opened == null) return { entries: [], migrated: false, verified: false };
    return { entries: opened, migrated: false, verified: true };
  }

  const original = parseEntries(live);
  if (!secretSeed) return { entries: original, migrated: false, verified: false };

  try {
    await io.backupPlaintext(live);
  } catch {
    return { entries: original, migrated: false, verified: false };
  }

  let sealed = "";
  try {
    sealed = await sealKeyManagerPayloadAsync(
      original,
      secretSeed,
      await randomBytes(),
      await randomBytes(),
    );
    const check = await openKeyManagerPayloadAsync(sealed, secretSeed);
    if (check == null || !sameEntries(original, check)) {
      return { entries: original, migrated: false, verified: false };
    }
  } catch {
    return { entries: original, migrated: false, verified: false };
  }

  await io.writeLive(sealed);
  const readback = unwrapStored(await io.readLive());
  const opened = await openKeyManagerPayloadAsync(readback, secretSeed);
  if (opened == null || !sameEntries(original, opened)) {
    await io.writeLive(live);
    return { entries: original, migrated: false, verified: false };
  }
  await io.removeBackup();
  return { entries: opened, migrated: true, verified: true };
}
