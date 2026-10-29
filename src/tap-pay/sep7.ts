// SEP-0007 `web+stellar:pay` URIs for phone-to-phone XLM.
//
// The same string is the NFC payload, the QR code, and the deep link.
// A request carries a nonce and a two-minute expiry. The on-chain memo
// repeats the nonce so the receiver can match the Horizon payment.

import { isStellarPublicKey } from "@/src/wallet/strkey";
import {
  MAINNET_DEPLOYMENT,
  TESTNET_DEPLOYMENT,
  type StellarNetwork,
} from "@/src/wallet/contract-config";

import {
  CHAIN_MEMO_PREFIX_BYTES,
  MEMO_TEXT_MAX_BYTES,
  NONCE_HEX_LEN,
  NOTE_MAX_CHARS,
  NOTE_ON_CHAIN_BYTES,
  ORIGIN_DOMAIN,
  REQUEST_TTL_MS,
} from "./constants";
import { canonicalAmount, trimAmount, truncateUtf8, utf8Length } from "./money";
import { assessExpiry, nonceHexOk, randomNonce } from "./replay";

export type UriErrorCode =
  | "invalid_uri"
  | "not_pay"
  | "destination"
  | "amount"
  | "asset"
  | "memo"
  | "nonce"
  | "expired"
  | "expiry_window"
  | "network";

export interface PayRequest {
  destination: string;
  /** Canonical 7-decimal XLM amount. */
  amount: string;
  /** Human note. May be longer than the bytes that fit beside the nonce. */
  memo: string;
  /** Exact MEMO_TEXT that is signed and matched on Horizon. */
  chainMemo: string;
  nonce: string;
  /** Unix milliseconds. */
  expiresAt: number;
  networkPassphrase: string;
  raw: string;
}

export type ParsedPayUri =
  | { ok: true; request: PayRequest }
  | { ok: false; code: UriErrorCode; message: string };

export function networkForPassphrase(passphrase: string): StellarNetwork | null {
  if (passphrase === TESTNET_DEPLOYMENT.networkPassphrase) return "testnet";
  if (passphrase === MAINNET_DEPLOYMENT.networkPassphrase) return "mainnet";
  return null;
}

export function normalizeNote(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, NOTE_MAX_CHARS);
}

/** `n:<nonce>:<note>` truncated so the UTF-8 form is at most 28 bytes. */
export function buildChainMemo(nonce: string, note: string): string {
  if (!nonceHexOk(nonce)) {
    throw new Error("Payment nonce must be 12 hex characters.");
  }
  const prefix = `n:${nonce}:`;
  if (utf8Length(prefix) !== CHAIN_MEMO_PREFIX_BYTES) {
    throw new Error("Payment nonce prefix is the wrong size.");
  }
  const memo = prefix + truncateUtf8(normalizeNote(note), NOTE_ON_CHAIN_BYTES);
  if (utf8Length(memo) > MEMO_TEXT_MAX_BYTES) {
    throw new Error("On-chain memo is longer than 28 bytes.");
  }
  return memo;
}

export function chainMemoParts(chainMemo: string): { nonce: string; note: string } | null {
  const match = /^n:([0-9a-f]{12}):(.*)$/.exec(chainMemo);
  if (!match) return null;
  if (utf8Length(chainMemo) > MEMO_TEXT_MAX_BYTES) return null;
  return { nonce: match[1], note: match[2] };
}

export interface CreatePayRequestInput {
  destination: string;
  amount: string;
  memo?: string;
  networkPassphrase: string;
  now?: number;
  nonce?: string;
}

export function createPayRequest(input: CreatePayRequestInput): PayRequest {
  if (!isStellarPublicKey(input.destination)) {
    throw new Error("Destination is not a Stellar address.");
  }
  const amount = canonicalAmount(input.amount);
  if (!amount) throw new Error("Amount must be a positive XLM amount.");
  const network = networkForPassphrase(input.networkPassphrase);
  if (!network) throw new Error("Network passphrase is not testnet or mainnet.");
  const nonce = (input.nonce ?? randomNonce()).toLowerCase();
  if (!nonceHexOk(nonce)) throw new Error("Payment nonce must be 12 hex characters.");
  const now = input.now ?? Date.now();
  const memo = normalizeNote(input.memo ?? "");
  const chainMemo = buildChainMemo(nonce, memo);
  const expiresAt = now + REQUEST_TTL_MS;
  const request: PayRequest = {
    destination: input.destination,
    amount,
    memo,
    chainMemo,
    nonce,
    expiresAt,
    networkPassphrase: input.networkPassphrase,
    raw: "",
  };
  request.raw = buildPayUri(request);
  return request;
}

export function buildPayUri(request: PayRequest): string {
  const params = new URLSearchParams();
  params.set("destination", request.destination);
  params.set("amount", request.amount);
  params.set("memo", request.chainMemo);
  params.set("memo_type", "MEMO_TEXT");
  if (request.memo) params.set("msg", request.memo);
  params.set("network_passphrase", request.networkPassphrase);
  params.set("nonce", request.nonce);
  params.set("expires", String(Math.floor(request.expiresAt / 1000)));
  params.set("origin_domain", ORIGIN_DOMAIN);
  return `web+stellar:pay?${params.toString()}`;
}

function fail(code: UriErrorCode, message: string): ParsedPayUri {
  return { ok: false, code, message };
}

/**
 * Accept `web+stellar:pay?...` and `web+stellar://pay?...`.
 * Unknown SEP-7 parameters are ignored. `callback` is ignored on purpose:
 * this app never posts the transaction to a URL in the link.
 */
export function parsePayUri(uri: string, now: number): ParsedPayUri {
  const trimmed = uri.trim();
  if (!/^web\+stellar:/i.test(trimmed)) {
    return fail("invalid_uri", "This is not a Stellar payment link.");
  }
  let url: URL;
  try {
    const hierarchical = trimmed
      .replace(/^web\+stellar:\/\//i, "https://stellartimelock.invalid/")
      .replace(/^web\+stellar:/i, "https://stellartimelock.invalid/");
    url = new URL(hierarchical);
  } catch {
    return fail("invalid_uri", "This payment link could not be read.");
  }
  const op = (url.pathname.replace(/^\//, "") || url.hostname).toLowerCase();
  if (op !== "pay") {
    return fail("not_pay", "This Stellar link is not a pay request.");
  }

  const destination = url.searchParams.get("destination")?.trim() ?? "";
  if (!isStellarPublicKey(destination)) {
    return fail("destination", "The recipient address in this link is not valid.");
  }

  const assetCode = url.searchParams.get("asset_code");
  const assetIssuer = url.searchParams.get("asset_issuer");
  if (assetIssuer || (assetCode && assetCode.toUpperCase() !== "XLM")) {
    return fail("asset", "Tap to pay sends native XLM only.");
  }

  const amount = canonicalAmount(url.searchParams.get("amount") ?? "");
  if (!amount) {
    return fail("amount", "The amount in this link is not a positive XLM amount.");
  }

  const memoType = (url.searchParams.get("memo_type") ?? "MEMO_TEXT").toUpperCase();
  if (memoType !== "MEMO_TEXT") {
    return fail("memo", "Tap to pay only accepts a text memo.");
  }
  const chainMemo = url.searchParams.get("memo") ?? "";
  const parts = chainMemoParts(chainMemo);
  if (!parts) {
    return fail("memo", "This payment link is missing its matching memo.");
  }

  const nonce = (url.searchParams.get("nonce") ?? "").trim().toLowerCase();
  if (!nonceHexOk(nonce) || nonce !== parts.nonce) {
    return fail("nonce", "This payment link has no usable nonce.");
  }

  const noteParam = url.searchParams.get("msg");
  const memo = normalizeNote(noteParam ?? parts.note);
  const expectedNote = truncateUtf8(memo, NOTE_ON_CHAIN_BYTES);
  if (expectedNote !== parts.note) {
    return fail("memo", "The note in this link does not match the on-chain memo.");
  }

  const expiresRaw = url.searchParams.get("expires") ?? "";
  if (!/^\d{10}$/.test(expiresRaw)) {
    return fail("expired", "This payment link has no two-minute expiry.");
  }
  const expiresAt = Number(expiresRaw) * 1000;
  const expiry = assessExpiry(expiresAt, now);
  if (expiry === "expired") {
    return fail("expired", "This payment request has expired. Ask for a new one.");
  }
  if (expiry === "expiry_window") {
    return fail("expiry_window", "This payment request lasts longer than two minutes.");
  }
  if (expiry !== "ok") {
    return fail("expired", "This payment link has no two-minute expiry.");
  }

  const networkPassphrase = url.searchParams.get("network_passphrase") ?? "";
  if (!networkForPassphrase(networkPassphrase)) {
    return fail("network", "This payment link is not for Stellar testnet or mainnet.");
  }

  return {
    ok: true,
    request: {
      destination,
      amount,
      memo,
      chainMemo,
      nonce,
      expiresAt,
      networkPassphrase,
      raw: trimmed,
    },
  };
}

export function displayAmount(amount: string): string {
  const canonical = canonicalAmount(amount);
  return canonical ? trimAmount(canonical) : amount;
}
