// Pure helpers for the biometric-cached 32-byte Ed25519 signing key.
// No React Native imports — safe for node tests.

import CryptoJS from "crypto-js";

import {
  decodeStrKey,
  encodeEd25519SecretSeed,
} from "@/src/wallet/strkey";

const SECRET_VERSION_BYTE = 18 << 3; // StrKey S… version

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function rawSigningKeyHexFromSecretSeed(seed: string): string {
  const decoded = decodeStrKey(seed.trim().replace(/\s+/g, "").toUpperCase());
  if (decoded.version !== SECRET_VERSION_BYTE) {
    throw new Error("Not a Stellar secret seed.");
  }
  if (decoded.payload.length !== 32) {
    throw new Error("Signing key must be 32 bytes.");
  }
  return bytesToHex(decoded.payload);
}

export function secretSeedFromRawSigningKeyHex(hex: string): string {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error("Signing key hex is the wrong length.");
  }
  return encodeEd25519SecretSeed(hexToBytes(clean));
}

export function wrapSigningKeyHex(
  hex: string,
  aesKey: CryptoJS.lib.WordArray,
): string {
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(CryptoJS.enc.Hex.parse(hex), aesKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const macInput = iv.clone().concat(encrypted.ciphertext);
  const mac = CryptoJS.HmacSHA256(macInput, aesKey);
  return (
    `${iv.toString(CryptoJS.enc.Base64)}.` +
    `${encrypted.ciphertext.toString(CryptoJS.enc.Base64)}.` +
    `${mac.toString(CryptoJS.enc.Base64)}`
  );
}

export function unwrapSigningKeyHex(
  payload: string,
  aesKey: CryptoJS.lib.WordArray,
): string | null {
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = CryptoJS.enc.Base64.parse(parts[0]);
    const ct = CryptoJS.enc.Base64.parse(parts[1]);
    const mac = CryptoJS.enc.Base64.parse(parts[2]);
    const expected = CryptoJS.HmacSHA256(iv.clone().concat(ct), aesKey);
    if (mac.toString() !== expected.toString()) return null;
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: ct }),
      aesKey,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
    );
    const hex = decrypted.toString(CryptoJS.enc.Hex);
    if (hex.length !== 64) return null;
    return hex;
  } catch {
    return null;
  }
}
