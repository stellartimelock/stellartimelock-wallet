// Built-in TOTP generator.
//
// RFC 6238 Time-based One-Time Password.
//
// - HMAC-SHA1 over an 8-byte big-endian counter (= floor(unixSeconds / 30))
// - Truncated per RFC 4226 to produce a 6-digit code.
// - Base32 secrets (Google Authenticator format) — spaces + lowercase
//   are tolerated on parse.
//
// Fully offline: no external calls, no key exchange. Works in Expo Go
// (uses crypto-js instead of native modules).

import CryptoJS from "crypto-js";

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normalizeSecret(secret: string): string {
  return secret.replace(/\s+/g, "").toUpperCase().replace(/=+$/g, "");
}

/** Validate a base32-encoded TOTP secret (Google Authenticator). */
export function isValidTotpSecret(secret: string): boolean {
  const s = normalizeSecret(secret);
  if (s.length < 16) return false;
  return /^[A-Z2-7]+$/.test(s);
}

/** Decode a base32 string to a WordArray. Whitespace + case-insensitive. */
function base32ToWordArray(secret: string): CryptoJS.lib.WordArray {
  const clean = normalizeSecret(secret);
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return CryptoJS.enc.Hex.parse(hex);
}

/**
 * Generate a 6-digit TOTP code for the given secret + timestamp.
 * `nowMs` defaults to Date.now() so the caller can pass a shifted
 * value for skew testing.
 */
export function generateTotpCode(secret: string, nowMs: number = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / 30);
  // 8-byte big-endian counter as a WordArray.
  const hex = counter.toString(16).padStart(16, "0");
  const counterWa = CryptoJS.enc.Hex.parse(hex);
  const key = base32ToWordArray(secret);
  const hmac = CryptoJS.HmacSHA1(counterWa, key);
  const hmacHex = hmac.toString(CryptoJS.enc.Hex);
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = parseInt(hmacHex.slice(-1), 16) * 2;
  const truncated = parseInt(hmacHex.slice(offset, offset + 8), 16) & 0x7fffffff;
  return (truncated % 1_000_000).toString().padStart(6, "0");
}

/** Seconds remaining in the current 30-second window. */
export function secondsRemaining(nowMs: number = Date.now()): number {
  return 30 - Math.floor((nowMs / 1000) % 30);
}
