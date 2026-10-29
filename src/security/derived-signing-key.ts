// Biometric-cached wallet signing material.
//
// House rule: the S… seed stays in RAM only. After the user types it
// once, we wrap the 32-byte Ed25519 payload (the derived signing key)
// with the biometric HKDF key and store that ciphertext. Later opens
// unlock with fingerprint, unwrap the 32 bytes, and rebuild the S…
// string in memory. The S… string is never written.

import CryptoJS from "crypto-js";

import {
  deriveKey,
  enroll,
  getBiometricAvailability,
  HKDF_INFO_WALLET_SIGNING,
  isEnrolled,
} from "@/src/security/biometric";
import {
  rawSigningKeyHexFromSecretSeed,
  secretSeedFromRawSigningKeyHex,
  unwrapSigningKeyHex,
  wrapSigningKeyHex,
} from "@/src/security/derived-signing-key-crypto";
import { readLockScope, writeLockScope } from "@/src/security/lock-scope-store";
import { storage } from "@/src/utils/storage";

export {
  rawSigningKeyHexFromSecretSeed,
  secretSeedFromRawSigningKeyHex,
  unwrapSigningKeyHex,
  wrapSigningKeyHex,
} from "@/src/security/derived-signing-key-crypto";

const BLOB_PREFIX = "xlm_vault_wallet_signing_v1_";
const FLAG_PREFIX = "xlm_vault_wallet_signing_flag_v1_";

let wrappingKey: CryptoJS.lib.WordArray | null = null;

function blobKey(id: string): string {
  return `${BLOB_PREFIX}${id}`;
}

function flagKey(id: string): string {
  return `${FLAG_PREFIX}${id}`;
}

export async function getWalletWrappingKey(): Promise<CryptoJS.lib.WordArray | null> {
  if (wrappingKey) return wrappingKey;
  const key = await deriveKey(HKDF_INFO_WALLET_SIGNING);
  if (!key) return null;
  wrappingKey = key;
  return key;
}

export async function hasDerivedSigningKey(id: string): Promise<boolean> {
  return !!(await storage.getItem<boolean>(flagKey(id), false));
}

export async function persistDerivedSigningKey(
  id: string,
  secretSeed: string,
): Promise<boolean> {
  let hex: string;
  try {
    hex = rawSigningKeyHexFromSecretSeed(secretSeed);
  } catch {
    return false;
  }

  let key = await getWalletWrappingKey();
  if (!key) {
    const availability = await getBiometricAvailability();
    if (availability !== "available" && availability !== "unsupported_web") {
      return false;
    }
    if (!(await isEnrolled())) {
      const enrolled = await enroll();
      if (!enrolled.ok) return false;
    }
    key = await getWalletWrappingKey();
  }
  if (!key) return false;

  const wrapped = wrapSigningKeyHex(hex, key);
  const ok = await storage.secureSet(blobKey(id), wrapped);
  if (!ok) return false;
  await storage.setItem(flagKey(id), true);
  if ((await readLockScope()) === "off") {
    await writeLockScope("entire_app");
  }
  return true;
}

export async function restoreSecretSeedFromDerivedKey(
  id: string,
): Promise<string | null> {
  const flagged = await storage.getItem<boolean>(flagKey(id), false);
  if (!flagged) return null;
  const key = await getWalletWrappingKey();
  if (!key) return null;
  const wrapped = await storage.secureGet<string>(blobKey(id), "");
  if (!wrapped) return null;
  const hex = unwrapSigningKeyHex(wrapped, key);
  if (!hex) return null;
  try {
    return secretSeedFromRawSigningKeyHex(hex);
  } catch {
    return null;
  }
}

export async function removeDerivedSigningKey(id: string): Promise<void> {
  await storage.secureRemove(blobKey(id));
  await storage.removeItem(flagKey(id));
  dropCachedWrappingKey();
}

/** Drop the in-memory wrapping key so the next unlock must read the biometric root. */
export function dropCachedWrappingKey(): void {
  wrappingKey = null;
}
