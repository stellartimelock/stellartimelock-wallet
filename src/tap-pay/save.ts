// On-device tap-to-pay document.
//
// One JSON file holds limits, used nonces, and payment history. Writers
// go through protectedWrite: temp file, .bak1–.bak5, and a shrink guard.

import type { StellarNetwork } from "@/src/wallet/contract-config";

import { DAILY_WINDOW_MS, NONCE_MEMORY_MS } from "./constants";
import { DEFAULT_TAP_LIMITS, normalizeLimits, type TapLimits } from "./limits";
import { canonicalAmount } from "./money";
import {
  forgetNonce,
  nonceKey,
  pruneNonces,
  rememberNonce,
  requestKey,
  type NonceEntry,
} from "./replay";

export interface TapPayment {
  id: string;
  role: "pay" | "request";
  network: StellarNetwork;
  destination: string;
  source: string;
  amount: string;
  memo: string;
  chainMemo: string;
  hash: string;
  ledger: number;
  createdAt: number;
  name: string;
}

export interface TapPaySave {
  v: 1;
  writtenAt: number;
  limits: TapLimits;
  nonces: Record<string, NonceEntry>;
  payments: TapPayment[];
  knownRecipients: string[];
  /** Destinations the user allowed once after checking the full address. */
  whitelistedDestinations: string[];
  /** When true, a new destination also needs a 6-digit authenticator code. */
  requireOtpForNewAddresses: boolean;
}

export function emptyTapPaySave(now = Date.now()): TapPaySave {
  return {
    v: 1,
    writtenAt: now,
    limits: { ...DEFAULT_TAP_LIMITS },
    nonces: {},
    payments: [],
    knownRecipients: [],
    whitelistedDestinations: [],
    requireOtpForNewAddresses: false,
  };
}

export function serializeTapPaySave(doc: TapPaySave): string {
  return JSON.stringify(doc);
}

export function parseTapPaySave(raw: string): TapPaySave | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TapPaySave>;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.payments)) return null;
    const base = emptyTapPaySave(typeof parsed.writtenAt === "number" ? parsed.writtenAt : Date.now());
    base.limits = normalizeLimits(parsed.limits);
    base.nonces = sanitizeNonces(parsed.nonces);
    base.payments = parsed.payments.filter(isPayment);
    base.knownRecipients = Array.isArray(parsed.knownRecipients)
      ? parsed.knownRecipients.filter((item) => typeof item === "string" && item.length > 0)
      : [];
    base.whitelistedDestinations = Array.isArray(parsed.whitelistedDestinations)
      ? parsed.whitelistedDestinations.filter((item) => typeof item === "string" && item.length > 0)
      : [];
    base.requireOtpForNewAddresses = parsed.requireOtpForNewAddresses === true;
    return base;
  } catch {
    return null;
  }
}

function sanitizeNonces(input: unknown): Record<string, NonceEntry> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, NonceEntry> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Partial<NonceEntry>;
    if (entry.state !== "pending" && entry.state !== "used") continue;
    if (typeof entry.expiresAt !== "number" || !Number.isFinite(entry.expiresAt)) continue;
    out[key] = { state: entry.state, expiresAt: entry.expiresAt };
  }
  return out;
}

function isPayment(value: unknown): value is TapPayment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TapPayment>;
  return (
    typeof row.id === "string" &&
    (row.role === "pay" || row.role === "request") &&
    (row.network === "testnet" || row.network === "mainnet") &&
    typeof row.destination === "string" &&
    typeof row.source === "string" &&
    typeof row.amount === "string" &&
    canonicalAmount(row.amount) != null &&
    typeof row.hash === "string" &&
    typeof row.createdAt === "number"
  );
}

export function spentSince(
  doc: TapPaySave,
  network: StellarNetwork,
  now: number,
  windowMs = DAILY_WINDOW_MS,
): string {
  let stroops = 0n;
  for (const payment of doc.payments) {
    if (payment.role !== "pay" || payment.network !== network) continue;
    if (payment.createdAt < now - windowMs) continue;
    const amount = canonicalAmount(payment.amount);
    if (!amount) continue;
    const value = BigInt(amount.replace(".", ""));
    stroops += value;
  }
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, "0");
  return `${whole.toString()}.${frac}`;
}

export function withLimits(doc: TapPaySave, limits: TapLimits, now: number): TapPaySave {
  return { ...doc, writtenAt: now, limits: normalizeLimits(limits) };
}

export function withNonceState(
  doc: TapPaySave,
  key: string,
  expiresAt: number,
  state: NonceEntry["state"],
  now: number,
): TapPaySave {
  return {
    ...doc,
    writtenAt: now,
    nonces: rememberNonce(doc.nonces, key, expiresAt, state),
  };
}

export function withoutNonce(doc: TapPaySave, key: string, now: number): TapPaySave {
  return { ...doc, writtenAt: now, nonces: forgetNonce(doc.nonces, key) };
}

export function withPayment(doc: TapPaySave, payment: TapPayment, now: number): TapPaySave {
  const known = new Set(doc.knownRecipients);
  if (payment.role === "pay") known.add(payment.destination);
  const nonces = rememberNonce(doc.nonces, nonceKey(payment.id), payment.createdAt, "used");
  return {
    ...doc,
    writtenAt: now,
    nonces,
    payments: [...doc.payments, { ...payment, amount: canonicalAmount(payment.amount) ?? payment.amount }],
    knownRecipients: [...known],
  };
}

export function withWhitelistedDestination(doc: TapPaySave, destination: string, now: number): TapPaySave {
  const dest = destination.trim();
  if (!dest) return doc;
  const next = new Set(doc.whitelistedDestinations);
  next.add(dest);
  return { ...doc, writtenAt: now, whitelistedDestinations: [...next] };
}

export function withOtpPref(doc: TapPaySave, requireOtpForNewAddresses: boolean, now: number): TapPaySave {
  return { ...doc, writtenAt: now, requireOtpForNewAddresses };
}

export function isWhitelistedDestination(doc: TapPaySave, destination: string): boolean {
  const dest = destination.trim();
  if (!dest) return false;
  return doc.whitelistedDestinations.includes(dest);
}

export function markRequestPaid(doc: TapPaySave, requestId: string, expiresAt: number, now: number): TapPaySave {
  if (!requestId.trim()) return doc;
  return withNonceState(doc, requestKey(requestId), expiresAt, "used", now);
}

/**
 * Prefer a pruned document when it does not shrink the file. A successful
 * payment must still be writable when pruning would trip the shrink guard.
 */
export function payloadForWrite(previous: string | null, doc: TapPaySave): string {
  const pruned = serializeTapPaySave({
    ...doc,
    nonces: pruneNonces(doc.nonces, doc.writtenAt, NONCE_MEMORY_MS),
  });
  if (previous == null || pruned.length >= previous.length) return pruned;
  const full = serializeTapPaySave(doc);
  if (full.length >= previous.length) return full;
  return full;
}
