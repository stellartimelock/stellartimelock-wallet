// Restore-screen file check.
//
// The picker opens the last folder and takes whatever the user taps.
// A Key Manager save and a Fortress file sit next to wallet backups.
// Those are not decrypted. The screen names the file and says what it is.
// A real .stvault / .os wrapper is opened with the wallet seed.
// Cipher v2 from 1.0–1.6.3 is PBKDF2-SHA256 (crypto-js 4.2.0's default).
// SHA-1 is tried second. Nothing here writes, deletes, or replaces a file.

import {
  cipherFormatLabel,
  detectEncryptedFormat,
  normalizeBackupCiphertext,
  type BackupCryptoVersion,
} from "@/src/security/backup-crypto";
import { FILE_FORMAT } from "@/src/utils/save-compat";

export type RestoreTone = "info" | "error";

export type ClassifiedBackup =
  | { kind: "wallet-backup"; payload: string }
  | { kind: "plaintext-envelope"; plaintext: string }
  | { kind: "not-wallet"; message: string };

const WALLET_FORMATS = new Set([
  FILE_FORMAT,
  "stellar_timelock_backup",
  "xlm-vault-backup",
  "stellar-timelock-vault",
]);

function looksLikePlainEnvelope(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.addresses) ||
    Array.isArray(value.totp) ||
    Array.isArray(value.keyManager) ||
    Array.isArray(value.walletMeta) ||
    (typeof value.device === "string" && (Array.isArray(value.notes) || Array.isArray(value.bills)))
  );
}

function shownName(fileName: string): string {
  const cleaned = fileName.replace(/[\u0000\r\n]/g, " ").trim() || "that file";
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

function quoted(fileName: string): string {
  return `\u201c${shownName(fileName)}\u201d`;
}

function notWallet(fileName: string, what: string): ClassifiedBackup {
  return {
    kind: "not-wallet",
    message: `${quoted(fileName)} is ${what} Pick a .stvault or .os wallet backup exported from this app.`,
  };
}

function unwrapLayers(raw: string): string {
  let text = raw.replace(/^\uFEFF/, "").trim();
  for (let i = 0; i < 2; i++) {
    if (!text.startsWith("\"")) break;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "string") break;
      text = parsed.replace(/^\uFEFF/, "").trim();
    } catch {
      break;
    }
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fortressFile(fileName: string, value: unknown): boolean {
  if (/fortress/i.test(fileName)) return true;
  if (!isRecord(value)) return false;
  const format = typeof value.format === "string" ? value.format : "";
  const app = typeof value.app === "string" ? value.app : "";
  const pkg = typeof value.package === "string" ? value.package : "";
  return /fortress/i.test(`${format} ${app} ${pkg}`);
}

function keyManagerName(fileName: string): boolean {
  return /key-manager/i.test(fileName);
}

export function decryptFailedMessage(
  fileName: string,
  format: BackupCryptoVersion | null,
): string {
  if (format == null) {
    return (
      `${quoted(fileName)} is a Stellar TimeLock wallet backup, but the ciphertext layout is unknown. ` +
      "This is not a seed mismatch."
    );
  }
  return (
    `Decryption failed for ${quoted(fileName)}. ` +
    `Detected format: ${cipherFormatLabel(format)}. ` +
    "This seed does not open it."
  );
}

export function classifyPickedBackup(fileName: string, raw: string): ClassifiedBackup {
  const text = unwrapLayers(raw);
  let parsed: unknown = undefined;
  let parsedOk = false;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      parsed = JSON.parse(text) as unknown;
      parsedOk = true;
    } catch {
      parsedOk = false;
    }
  }

  if (parsedOk && isRecord(parsed) && typeof parsed.format === "string" && WALLET_FORMATS.has(parsed.format)) {
    if (typeof parsed.payload === "string") {
      return { kind: "wallet-backup", payload: parsed.payload };
    }
    // Older writers stored the envelope object instead of a ciphertext string.
    if (isRecord(parsed.payload) || Array.isArray(parsed.payload)) {
      return { kind: "plaintext-envelope", plaintext: JSON.stringify(parsed.payload) };
    }
  }

  if (parsedOk && isRecord(parsed) && looksLikePlainEnvelope(parsed)) {
    return { kind: "plaintext-envelope", plaintext: text };
  }

  if (parsedOk && Array.isArray(parsed)) {
    return notWallet(fileName, "a Key Manager list, not a wallet backup.");
  }

  if (detectEncryptedFormat(text) != null || keyManagerName(fileName)) {
    return notWallet(fileName, "a Key Manager save, not a wallet backup.");
  }

  if (fortressFile(fileName, parsedOk ? parsed : undefined)) {
    return notWallet(fileName, "a Fortress file, not a Stellar TimeLock wallet backup.");
  }

  return notWallet(fileName, "not a Stellar TimeLock wallet backup.");
}

export async function openClassifiedBackup(
  fileName: string,
  raw: string,
  secretSeed: string,
  decryptPayload: (payload: string, seed: string) => Promise<string> | string,
): Promise<
  | { ok: true; plaintext: string }
  | { ok: false; tone: RestoreTone; error: string }
> {
  const classified = classifyPickedBackup(fileName, raw);
  if (classified.kind === "plaintext-envelope") {
    return { ok: true, plaintext: classified.plaintext };
  }
  if (classified.kind !== "wallet-backup") {
    return { ok: false, tone: "info", error: classified.message };
  }
  const payload = normalizeBackupCiphertext(classified.payload);
  const format = detectEncryptedFormat(payload);
  if (format == null) {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return { ok: true, plaintext: trimmed };
    }
    return { ok: false, tone: "info", error: decryptFailedMessage(fileName, null) };
  }
  let plaintext = "";
  try {
    plaintext = await decryptPayload(payload, secretSeed);
  } catch {
    plaintext = "";
  }
  if (!plaintext) {
    return { ok: false, tone: "error", error: decryptFailedMessage(fileName, format) };
  }
  return { ok: true, plaintext };
}
