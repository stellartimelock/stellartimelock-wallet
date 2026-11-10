// Seed-derived backup encryption.
//
// Three layouts, all opened by decryptBackup:
//   v1  base64(iv).base64(ciphertext)
//       AES-256-CBC. No MAC.
//   v2  base64(iv).base64(ciphertext).base64(hmac)
//       Same AES key, plus a second PBKDF2 key for HMAC-SHA256 over iv || ciphertext.
//   v3  v3.base64(salt).base64(iv).base64(ciphertext).base64(hmac)
//       PBKDF2-SHA256, 100,000 rounds, random salt, separate AES and MAC keys.
//
// 1.0.0 through 1.6.3 called CryptoJS.PBKDF2 with no hasher. crypto-js 4.2.0
// defaults that to SHA-256, 10,000 rounds, salts xlm_vault_notebook_v2_salt
// and xlm_vault_notebook_v2_mac_salt. 1.6.4 started reading those files as
// SHA-1, so a real backup failed the MAC and restore blamed the seed.
// v1 and v2 now try SHA-256 first, then SHA-1. New files are v3.

import CryptoJS from "crypto-js";
import { sha1 as nobleSha1 } from "@noble/hashes/legacy.js";
import { pbkdf2Async as noblePbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";

import { utf8ToMutableBytes, wipeBytes, wipeWordArray } from "@/src/security/secure-wipe";

const V1_V2_AES_SALT = "xlm_vault_notebook_v2_salt";
const V2_MAC_SALT = "xlm_vault_notebook_v2_mac_salt";
const V1_V2_ITERATIONS = 10000;
export const V3_KDF_ITERATIONS = 100_000;

export type BackupCryptoVersion = 1 | 2 | 3;

function wordsFromBytes(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      ((bytes[i] ?? 0) << 24) |
        ((bytes[i + 1] ?? 0) << 16) |
        ((bytes[i + 2] ?? 0) << 8) |
        (bytes[i + 3] ?? 0),
    );
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function wordArraysEqualConstantTime(
  a: CryptoJS.lib.WordArray,
  b: CryptoJS.lib.WordArray,
): boolean {
  if (a.sigBytes !== b.sigBytes) return false;
  const aw = a.words;
  const bw = b.words;
  const n = Math.ceil(a.sigBytes / 4);
  let diff = 0;
  for (let i = 0; i < n; i++) diff |= (aw[i] ?? 0) ^ (bw[i] ?? 0);
  return diff === 0;
}

function pbkdf2(
  seedWords: CryptoJS.lib.WordArray,
  salt: CryptoJS.lib.WordArray,
  iterations: number,
  keyBytes: number,
  sha256: boolean,
): CryptoJS.lib.WordArray {
  return CryptoJS.PBKDF2(seedWords, salt, {
    keySize: keyBytes / 4,
    iterations,
    hasher: sha256 ? CryptoJS.algo.SHA256 : CryptoJS.algo.SHA1,
  });
}

/**
 * How many PBKDF2 iterations run before the JS thread yields, used
 * only by the CryptoJS fallback. Native Web Crypto and noble hashes
 * are preferred; this chunk is large so a fallback still finishes.
 */
export const PBKDF2_YIELD_EVERY = 20_000;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function wordArrayToBytes(wa: CryptoJS.lib.WordArray): Uint8Array {
  const bytes = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < wa.sigBytes; i++) {
    bytes[i] = ((wa.words[i >>> 2] ?? 0) >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return bytes;
}

/**
 * RFC 2898 PBKDF2 via `crypto.subtle` when the runtime provides it
 * (web, recent Node, some native engines). Same bytes as CryptoJS.
 */
async function pbkdf2WebCrypto(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyBytes: number,
  sha256: boolean,
): Promise<Uint8Array | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.importKey || !subtle.deriveBits) return null;
  try {
    const key = await subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: sha256 ? "SHA-256" : "SHA-1",
        salt,
        iterations,
      },
      key,
      keyBytes * 8,
    );
    return new Uint8Array(bits);
  } catch {
    return null;
  }
}

/**
 * Same bytes as CryptoJS.PBKDF2 (HMAC loop: U1 = HMAC(salt || block),
 * then Ui = HMAC(U{i-1}), XOR into the block). Prefers native Web
 * Crypto, then noble hashes (already in the app), then a yielding
 * CryptoJS fallback so a missing native path cannot freeze the UI.
 */
export async function pbkdf2Async(
  password: CryptoJS.lib.WordArray,
  salt: CryptoJS.lib.WordArray,
  iterations: number,
  keyBytes: number,
  sha256: boolean,
): Promise<CryptoJS.lib.WordArray> {
  const passwordBytes = wordArrayToBytes(password);
  const saltBytes = wordArrayToBytes(salt);
  try {
    const native = await pbkdf2WebCrypto(
      passwordBytes,
      saltBytes,
      iterations,
      keyBytes,
      sha256,
    );
    if (native) return wordsFromBytes(native);
    const out = await noblePbkdf2Async(sha256 ? nobleSha256 : nobleSha1, passwordBytes, saltBytes, {
      c: iterations,
      dkLen: keyBytes,
      asyncTick: 16,
    });
    return wordsFromBytes(out);
  } catch {
    // Fall through to the CryptoJS loop if noble/webcrypto throws.
  } finally {
    wipeBytes(passwordBytes);
    wipeBytes(saltBytes);
  }

  const hasher = sha256 ? CryptoJS.algo.SHA256 : CryptoJS.algo.SHA1;
  const hmac = CryptoJS.algo.HMAC.create(hasher, password);
  const derivedKey = CryptoJS.lib.WordArray.create();
  const blockIndex = CryptoJS.lib.WordArray.create([0x00000001]);
  const derivedKeyWords = derivedKey.words;
  const blockIndexWords = blockIndex.words;
  const keySize = keyBytes / 4;
  let sinceYield = 0;

  while (derivedKeyWords.length < keySize) {
    const block = hmac.update(salt).finalize(blockIndex);
    hmac.reset();
    const blockWords = block.words;
    const blockWordsLength = blockWords.length;
    let intermediate: CryptoJS.lib.WordArray = block;
    for (let i = 1; i < iterations; i++) {
      intermediate = hmac.finalize(intermediate);
      hmac.reset();
      const intermediateWords = intermediate.words;
      for (let j = 0; j < blockWordsLength; j++) {
        blockWords[j] ^= intermediateWords[j] ?? 0;
      }
      sinceYield += 1;
      if (sinceYield >= PBKDF2_YIELD_EVERY) {
        sinceYield = 0;
        await yieldToEventLoop();
      }
    }
    derivedKey.concat(block);
    blockIndexWords[0] = (blockIndexWords[0] ?? 0) + 1;
  }
  derivedKey.sigBytes = keySize * 4;
  return derivedKey;
}

function seedWords(secretSeed: string): { words: CryptoJS.lib.WordArray; bytes: Uint8Array } {
  const bytes = utf8ToMutableBytes(secretSeed);
  return { words: wordsFromBytes(bytes), bytes };
}

function deriveV2Keys(
  secretSeed: string,
  sha256: boolean,
): {
  aesKey: CryptoJS.lib.WordArray;
  macKey: CryptoJS.lib.WordArray;
} {
  const seeded = seedWords(secretSeed);
  try {
    const aesKey = pbkdf2(
      seeded.words,
      CryptoJS.enc.Utf8.parse(V1_V2_AES_SALT),
      V1_V2_ITERATIONS,
      32,
      sha256,
    );
    const macKey = pbkdf2(
      seeded.words,
      CryptoJS.enc.Utf8.parse(V2_MAC_SALT),
      V1_V2_ITERATIONS,
      32,
      sha256,
    );
    return { aesKey, macKey };
  } finally {
    wipeWordArray(seeded.words);
    wipeBytes(seeded.bytes);
  }
}

function splitV3Keys(mixed: CryptoJS.lib.WordArray): {
  aesKey: CryptoJS.lib.WordArray;
  macKey: CryptoJS.lib.WordArray;
} {
  const aesKey = CryptoJS.lib.WordArray.create(mixed.words.slice(0, 8), 32);
  const macKey = CryptoJS.lib.WordArray.create(mixed.words.slice(8, 16), 32);
  wipeWordArray(mixed);
  return { aesKey, macKey };
}

function deriveV3Keys(
  secretSeed: string,
  salt: CryptoJS.lib.WordArray,
): { aesKey: CryptoJS.lib.WordArray; macKey: CryptoJS.lib.WordArray } {
  const seeded = seedWords(secretSeed);
  try {
    return splitV3Keys(pbkdf2(seeded.words, salt, V3_KDF_ITERATIONS, 64, true));
  } finally {
    wipeWordArray(seeded.words);
    wipeBytes(seeded.bytes);
  }
}

async function deriveV2KeysAsync(
  secretSeed: string,
  sha256: boolean,
): Promise<{
  aesKey: CryptoJS.lib.WordArray;
  macKey: CryptoJS.lib.WordArray;
}> {
  const seeded = seedWords(secretSeed);
  try {
    const aesKey = await pbkdf2Async(
      seeded.words,
      CryptoJS.enc.Utf8.parse(V1_V2_AES_SALT),
      V1_V2_ITERATIONS,
      32,
      sha256,
    );
    const macKey = await pbkdf2Async(
      seeded.words,
      CryptoJS.enc.Utf8.parse(V2_MAC_SALT),
      V1_V2_ITERATIONS,
      32,
      sha256,
    );
    return { aesKey, macKey };
  } finally {
    wipeWordArray(seeded.words);
    wipeBytes(seeded.bytes);
  }
}

async function deriveV3KeysAsync(
  secretSeed: string,
  salt: CryptoJS.lib.WordArray,
): Promise<{ aesKey: CryptoJS.lib.WordArray; macKey: CryptoJS.lib.WordArray }> {
  const seeded = seedWords(secretSeed);
  try {
    return splitV3Keys(
      await pbkdf2Async(seeded.words, salt, V3_KDF_ITERATIONS, 64, true),
    );
  } finally {
    wipeWordArray(seeded.words);
    wipeBytes(seeded.bytes);
  }
}

function aesEncrypt(
  plaintext: string,
  aesKey: CryptoJS.lib.WordArray,
  iv: CryptoJS.lib.WordArray,
): CryptoJS.lib.WordArray {
  return CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plaintext), aesKey, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext;
}

function aesDecrypt(
  ct: CryptoJS.lib.WordArray,
  aesKey: CryptoJS.lib.WordArray,
  iv: CryptoJS.lib.WordArray,
): string {
  try {
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: ct }),
      aesKey,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
    );
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch {
    return "";
  }
}

function ivFromBytes(bytes: Uint8Array): CryptoJS.lib.WordArray {
  return wordsFromBytes(bytes.subarray(0, 16));
}

export function encryptV1(plaintext: string, secretSeed: string, iv: Uint8Array): string {
  const { aesKey, macKey } = deriveV2Keys(secretSeed, false);
  try {
    const ivWords = ivFromBytes(iv);
    const ct = aesEncrypt(plaintext, aesKey, ivWords);
    return `${ivWords.toString(CryptoJS.enc.Base64)}.${ct.toString(CryptoJS.enc.Base64)}`;
  } finally {
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
  }
}

export function encryptV2(plaintext: string, secretSeed: string, iv: Uint8Array): string {
  const { aesKey, macKey } = deriveV2Keys(secretSeed, false);
  try {
    const ivWords = ivFromBytes(iv);
    const ct = aesEncrypt(plaintext, aesKey, ivWords);
    const mac = CryptoJS.HmacSHA256(ivWords.clone().concat(ct.clone()), macKey);
    return (
      `${ivWords.toString(CryptoJS.enc.Base64)}.` +
      `${ct.toString(CryptoJS.enc.Base64)}.` +
      `${mac.toString(CryptoJS.enc.Base64)}`
    );
  } finally {
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
  }
}

/**
 * Byte-for-byte what `encrypt()` wrote from 1.0.0 through 1.6.3.
 * CryptoJS.PBKDF2 is called with no hasher. In crypto-js 4.2.0 that
 * is SHA-256. Do not "fix" this helper by passing SHA-1.
 */
export function encryptV2CryptoJsDefault(
  plaintext: string,
  secretSeed: string,
  iv: Uint8Array,
): string {
  const seeded = seedWords(secretSeed);
  const aesKey = CryptoJS.PBKDF2(seeded.words, CryptoJS.enc.Utf8.parse(V1_V2_AES_SALT), {
    keySize: 256 / 32,
    iterations: V1_V2_ITERATIONS,
  });
  const macKey = CryptoJS.PBKDF2(seeded.words, CryptoJS.enc.Utf8.parse(V2_MAC_SALT), {
    keySize: 256 / 32,
    iterations: V1_V2_ITERATIONS,
  });
  try {
    const ivWords = ivFromBytes(iv);
    const ct = aesEncrypt(plaintext, aesKey, ivWords);
    const mac = CryptoJS.HmacSHA256(ivWords.clone().concat(ct.clone()), macKey);
    return (
      `${ivWords.toString(CryptoJS.enc.Base64)}.` +
      `${ct.toString(CryptoJS.enc.Base64)}.` +
      `${mac.toString(CryptoJS.enc.Base64)}`
    );
  } finally {
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
    wipeWordArray(seeded.words);
    wipeBytes(seeded.bytes);
  }
}

export function encryptV3(
  plaintext: string,
  secretSeed: string,
  iv: Uint8Array,
  salt: Uint8Array,
): string {
  const saltWords = wordsFromBytes(salt);
  const { aesKey, macKey } = deriveV3Keys(secretSeed, saltWords);
  try {
    const ivWords = ivFromBytes(iv);
    const ct = aesEncrypt(plaintext, aesKey, ivWords);
    const mac = CryptoJS.HmacSHA256(ivWords.clone().concat(ct.clone()), macKey);
    return (
      `v3.${saltWords.toString(CryptoJS.enc.Base64)}.` +
      `${ivWords.toString(CryptoJS.enc.Base64)}.` +
      `${ct.toString(CryptoJS.enc.Base64)}.` +
      `${mac.toString(CryptoJS.enc.Base64)}`
    );
  } finally {
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
    wipeWordArray(saltWords);
  }
}

function plausibleBackupPlaintext(plain: string): boolean {
  const first = plain.trim().charAt(0);
  return first === "{" || first === "[" || first === "\"";
}

function decryptV1With(
  ivB64: string,
  ctB64: string,
  secretSeed: string,
  sha256: boolean,
): string {
  const { aesKey, macKey } = deriveV2Keys(secretSeed, sha256);
  try {
    return aesDecrypt(
      CryptoJS.enc.Base64.parse(ctB64),
      aesKey,
      CryptoJS.enc.Base64.parse(ivB64),
    );
  } finally {
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
  }
}

function decryptV1(ivB64: string, ctB64: string, secretSeed: string): string {
  // SHA-256 is what CryptoJS 4 wrote when the caller omitted the hasher.
  // SHA-1 is what 1.6.4–1.6.7 used for this layout. v1 has no MAC, so
  // only a JSON-looking result counts.
  const sha256Plain = decryptV1With(ivB64, ctB64, secretSeed, true);
  if (plausibleBackupPlaintext(sha256Plain)) return sha256Plain;
  const sha1Plain = decryptV1With(ivB64, ctB64, secretSeed, false);
  if (plausibleBackupPlaintext(sha1Plain)) return sha1Plain;
  return "";
}

function decryptV2With(
  iv: CryptoJS.lib.WordArray,
  ct: CryptoJS.lib.WordArray,
  expected: CryptoJS.lib.WordArray,
  secretSeed: string,
  sha256: boolean,
): string {
  const { aesKey, macKey } = deriveV2Keys(secretSeed, sha256);
  const computed = CryptoJS.HmacSHA256(iv.clone().concat(ct.clone()), macKey);
  try {
    if (!wordArraysEqualConstantTime(computed, expected)) return "";
    return aesDecrypt(ct, aesKey, iv);
  } finally {
    wipeWordArray(computed);
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
  }
}

function decryptV2(ivB64: string, ctB64: string, macB64: string, secretSeed: string): string {
  const iv = CryptoJS.enc.Base64.parse(ivB64);
  const ct = CryptoJS.enc.Base64.parse(ctB64);
  const expected = CryptoJS.enc.Base64.parse(macB64);
  const sha256Plain = decryptV2With(iv, ct, expected, secretSeed, true);
  if (sha256Plain) return sha256Plain;
  return decryptV2With(iv, ct, expected, secretSeed, false);
}

function decryptV3(parts: string[], secretSeed: string): string {
  if (parts.length !== 5 || parts[0] !== "v3") return "";
  const salt = CryptoJS.enc.Base64.parse(parts[1]);
  const iv = CryptoJS.enc.Base64.parse(parts[2]);
  const ct = CryptoJS.enc.Base64.parse(parts[3]);
  const expected = CryptoJS.enc.Base64.parse(parts[4]);
  const { aesKey, macKey } = deriveV3Keys(secretSeed, salt);
  const computed = CryptoJS.HmacSHA256(iv.clone().concat(ct.clone()), macKey);
  try {
    if (!wordArraysEqualConstantTime(computed, expected)) return "";
    return aesDecrypt(ct, aesKey, iv);
  } finally {
    wipeWordArray(computed);
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
    wipeWordArray(salt);
  }
}

function secretCandidates(secretSeed: string): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    if (!value || out.includes(value)) return;
    out.push(value);
  };
  add(secretSeed);
  const trimmed = secretSeed.trim();
  add(trimmed);
  add(trimmed.toUpperCase());
  add(trimmed.toLowerCase());
  const stripped = trimmed.replace(/\s+/g, "");
  add(stripped);
  add(stripped.toUpperCase());
  add(stripped.toLowerCase());
  return out;
}

/**
 * Undo the ways a real file can wrap the same ciphertext: a BOM,
 * a JSON string around the payload, line breaks from a mailer or
 * Android Base64.DEFAULT, and base64url (`-` `_`, padding omitted).
 */
export function normalizeBackupCiphertext(payload: string): string {
  let text = payload.replace(/^\uFEFF/, "").trim();
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
  text = text.replace(/\s+/g, "");
  if (text.includes("-") || text.includes("_")) {
    text = text.replace(/-/g, "+").replace(/_/g, "/");
  }
  return text;
}

function decryptOne(payload: string, secretSeed: string): string {
  if (!payload || payload.indexOf(".") < 0) return "";
  const parts = payload.split(".");
  if (parts[0] === "v3") return decryptV3(parts, secretSeed);
  if (parts.length === 3) return decryptV2(parts[0], parts[1], parts[2], secretSeed);
  if (parts.length === 2) return decryptV1(parts[0], parts[1], secretSeed);
  return "";
}

export function decryptBackup(payload: string, secretSeed: string): string {
  const text = normalizeBackupCiphertext(payload);
  for (const secret of secretCandidates(secretSeed)) {
    const plain = decryptOne(text, secret);
    if (plain) return plain;
  }
  return "";
}

export async function encryptV3Async(
  plaintext: string,
  secretSeed: string,
  iv: Uint8Array,
  salt: Uint8Array,
): Promise<string> {
  const saltWords = wordsFromBytes(salt);
  const { aesKey, macKey } = await deriveV3KeysAsync(secretSeed, saltWords);
  try {
    const ivWords = ivFromBytes(iv);
    const ct = aesEncrypt(plaintext, aesKey, ivWords);
    const mac = CryptoJS.HmacSHA256(ivWords.clone().concat(ct.clone()), macKey);
    return (
      `v3.${saltWords.toString(CryptoJS.enc.Base64)}.` +
      `${ivWords.toString(CryptoJS.enc.Base64)}.` +
      `${ct.toString(CryptoJS.enc.Base64)}.` +
      `${mac.toString(CryptoJS.enc.Base64)}`
    );
  } finally {
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
    wipeWordArray(saltWords);
  }
}

async function decryptV2Async(
  ivB64: string,
  ctB64: string,
  macB64: string,
  secretSeed: string,
): Promise<string> {
  const iv = CryptoJS.enc.Base64.parse(ivB64);
  const ct = CryptoJS.enc.Base64.parse(ctB64);
  const expected = CryptoJS.enc.Base64.parse(macB64);
  for (const sha256 of [true, false]) {
    const { aesKey, macKey } = await deriveV2KeysAsync(secretSeed, sha256);
    const computed = CryptoJS.HmacSHA256(iv.clone().concat(ct.clone()), macKey);
    try {
      if (!wordArraysEqualConstantTime(computed, expected)) continue;
      return aesDecrypt(ct, aesKey, iv);
    } finally {
      wipeWordArray(computed);
      wipeWordArray(aesKey);
      wipeWordArray(macKey);
    }
  }
  return "";
}

async function decryptV3Async(parts: string[], secretSeed: string): Promise<string> {
  if (parts.length !== 5 || parts[0] !== "v3") return "";
  const salt = CryptoJS.enc.Base64.parse(parts[1]);
  const iv = CryptoJS.enc.Base64.parse(parts[2]);
  const ct = CryptoJS.enc.Base64.parse(parts[3]);
  const expected = CryptoJS.enc.Base64.parse(parts[4]);
  const { aesKey, macKey } = await deriveV3KeysAsync(secretSeed, salt);
  const computed = CryptoJS.HmacSHA256(iv.clone().concat(ct.clone()), macKey);
  try {
    if (!wordArraysEqualConstantTime(computed, expected)) return "";
    return aesDecrypt(ct, aesKey, iv);
  } finally {
    wipeWordArray(computed);
    wipeWordArray(aesKey);
    wipeWordArray(macKey);
    wipeWordArray(salt);
  }
}

/** Opens v1, v2, and v3. v3 yields during the 100,000-round KDF. */
export async function decryptBackupAsync(payload: string, secretSeed: string): Promise<string> {
  const text = normalizeBackupCiphertext(payload);
  if (!text || text.indexOf(".") < 0) return "";
  const parts = text.split(".");
  // Two-part files are 10,000 rounds and have no MAC. The sync opener
  // already tries both hashers and every seed spelling.
  if (parts.length === 2 && parts[0] !== "v3") return decryptBackup(text, secretSeed);
  for (const secret of secretCandidates(secretSeed)) {
    const plain =
      parts[0] === "v3"
        ? await decryptV3Async(parts, secret)
        : parts.length === 3
          ? await decryptV2Async(parts[0], parts[1], parts[2], secret)
          : "";
    if (plain) return plain;
  }
  return "";
}

const B64 = /^[A-Za-z0-9+/=]+$/;

export function isEncryptedPayload(s: string): boolean {
  if (typeof s !== "string" || s.length < 16) return false;
  const parts = s.split(".");
  if (parts[0] === "v3") {
    return parts.length === 5 && parts.slice(1).every((p) => B64.test(p));
  }
  if (parts.length !== 2 && parts.length !== 3) return false;
  return parts.every((p) => p.length >= 4 && B64.test(p));
}

export function detectEncryptedFormat(s: string): BackupCryptoVersion | null {
  const text = normalizeBackupCiphertext(s);
  if (!isEncryptedPayload(text)) return null;
  const parts = text.split(".");
  if (parts[0] === "v3" && parts.length === 5) return 3;
  if (parts.length === 3) return 2;
  if (parts.length === 2) return 1;
  return null;
}

export function cipherFormatLabel(version: BackupCryptoVersion | null): string {
  if (version === 1) return "cipher v1 (iv.ct)";
  if (version === 2) return "cipher v2 (iv.ct.mac)";
  if (version === 3) return "cipher v3 (v3.salt.iv.ct.mac)";
  return "unknown ciphertext";
}
