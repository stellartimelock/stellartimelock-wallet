// Open a .stvault or .os backup without touching device storage.
// The ciphertext may be v1 (two-part), v2, or v3. The JSON inside may be
// envelope v1 through v8. Missing sections are left missing.

import {
  cipherFormatLabel,
  decryptBackup,
  detectEncryptedFormat,
  normalizeBackupCiphertext,
  type BackupCryptoVersion,
} from "@/src/security/backup-crypto";

const ENVELOPE_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

export interface OpenedBackup {
  cryptoVersion: BackupCryptoVersion;
  envelope: Record<string, unknown>;
}

export function openBackupDocument(
  raw: string,
  secretSeed: string,
): { ok: true; backup: OpenedBackup } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  const file = parsed as { format?: unknown; payload?: unknown } | null;
  if (!file || file.format !== "stellar-timelock-backup" || typeof file.payload !== "string") {
    return { ok: false, error: "Unknown backup file" };
  }
  const payload = normalizeBackupCiphertext(file.payload);
  const cryptoVersion = detectEncryptedFormat(payload);
  if (cryptoVersion == null) {
    return { ok: false, error: "Unknown ciphertext. This is not a seed mismatch." };
  }
  const plain = decryptBackup(payload, secretSeed);
  if (!plain) {
    return {
      ok: false,
      error: `Decrypt failed. Detected format: ${cipherFormatLabel(cryptoVersion)}. This seed does not open it.`,
    };
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(plain);
  } catch {
    return { ok: false, error: "Envelope was not JSON" };
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ok: false, error: "Envelope was empty" };
  }
  const version = (envelope as { v?: unknown }).v;
  if (typeof version !== "number" || !ENVELOPE_VERSIONS.has(version)) {
    return { ok: false, error: "Unknown envelope version" };
  }
  return {
    ok: true,
    backup: { cryptoVersion, envelope: envelope as Record<string, unknown> },
  };
}
