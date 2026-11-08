// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Stellar TimeLock contributors
//
// Seed-derived AES-256 encryption for wallet backups.
// Portable across devices — same Stellar secret seed = same keys.
// New writes are format v3. Reads still open v1 (two-part) and v2.

import * as Crypto from "expo-crypto";

import {
  decryptBackupAsync,
  detectEncryptedFormat,
  encryptV3,
  isEncryptedPayload,
} from "@/src/security/backup-crypto";

export { detectEncryptedFormat, isEncryptedPayload };

export async function encrypt(plaintext: string, secretSeed: string): Promise<string> {
  const iv = await Crypto.getRandomBytesAsync(16);
  const salt = await Crypto.getRandomBytesAsync(16);
  return encryptV3(plaintext, secretSeed, iv, salt);
}

/**
 * Decrypt a backup payload. v1 (iv.ct), v2 (iv.ct.mac), and v3 all open
 * with the wallet seed. v1 and v2 try the 1.0–1.6.3 SHA-256 key and the
 * SHA-1 key 1.6.4 used. Returns "" for empty, tampered, or wrong-seed input.
 */
export async function decrypt(payload: string, secretSeed: string): Promise<string> {
  return decryptBackupAsync(payload, secretSeed);
}
