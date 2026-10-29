// Replay protection for a tap-to-pay request.
//
// A request is payable once, and only inside its two-minute window.
// Used nonces stay in the save file after expiry so a captured link
// cannot be paid again during the memory window.

import { EXPIRY_SKEW_MS, NONCE_HEX_LEN, REQUEST_TTL_MS } from "./constants";

const NONCE_RE = /^[0-9a-f]{12}$/;

export function nonceHexOk(nonce: string): boolean {
  return NONCE_RE.test(nonce) && nonce.length === NONCE_HEX_LEN;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(NONCE_HEX_LEN / 2);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("A random source is not available for the payment nonce.");
  }
  cryptoObj.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export type ExpiryCode = "ok" | "expired" | "expiry_window" | "invalid";

export function assessExpiry(expiresAt: number, now: number): ExpiryCode {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return "invalid";
  if (expiresAt <= now) return "expired";
  if (expiresAt - now > REQUEST_TTL_MS + EXPIRY_SKEW_MS) return "expiry_window";
  return "ok";
}

export type NonceState = "pending" | "used";

export interface NonceEntry {
  expiresAt: number;
  state: NonceState;
}

export type ReplayCode = "ok" | "replay" | "pending";

/**
 * `n:` keys are URI nonces. `r:` keys are sibling-app request ids, so a
 * Market or Delivery Driver checkout cannot be signed twice.
 */
export function nonceKey(nonce: string): string {
  return `n:${nonce.toLowerCase()}`;
}

export function requestKey(requestId: string): string {
  return `r:${requestId.trim()}`;
}

export function assessReplay(
  seen: Readonly<Record<string, NonceEntry>>,
  key: string,
  now: number,
): ReplayCode {
  const entry = seen[key];
  if (!entry) return "ok";
  if (entry.state === "used") return "replay";
  if (entry.expiresAt > now) return "pending";
  return "ok";
}

export function rememberNonce(
  seen: Record<string, NonceEntry>,
  key: string,
  expiresAt: number,
  state: NonceState,
): Record<string, NonceEntry> {
  return { ...seen, [key]: { expiresAt, state } };
}

export function forgetNonce(
  seen: Record<string, NonceEntry>,
  key: string,
): Record<string, NonceEntry> {
  if (!(key in seen)) return seen;
  const next = { ...seen };
  delete next[key];
  return next;
}

/** Drop pending nonces that already expired, and used nonces a day after expiry. */
export function pruneNonces(
  seen: Record<string, NonceEntry>,
  now: number,
  memoryMs: number,
): Record<string, NonceEntry> {
  const next: Record<string, NonceEntry> = {};
  for (const [key, entry] of Object.entries(seen)) {
    if (entry.state === "pending" && entry.expiresAt <= now) continue;
    if (entry.state === "used" && entry.expiresAt + memoryMs <= now) continue;
    next[key] = entry;
  }
  return next;
}
