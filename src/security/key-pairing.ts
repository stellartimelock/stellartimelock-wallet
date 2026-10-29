// Key Manager ↔ Fortress Key Manager pairing — matches STELLAR_VAULT PR #21.
//
// QR text:  stellarvault://kmpair?d=<base64url(UTF-8 JSON)>
// QR JSON:  { v:1, t:"km-pair", sessionId, pubKey, relay, localAddr? }
//   sessionId  16 random bytes as lowercase hex (32 chars)
//   pubKey     base64 X25519 public key of the initiator
//   relay      https://fortress-bot.stellartimelock.workers.dev
//   localAddr  optional LAN base URL for local-first attempt
//
// Crypto:
//   ECDH:  X25519 (@noble/curves/ed25519.js — v2 has no @noble/curves/x25519 export)
//   KDF:   HKDF-SHA-256, info "stellar-vault/key-manager-pair/v1", 32-byte out
//   AEAD:  XChaCha20-Poly1305 (@noble/ciphers/chacha.js)
//   Seed box JSON: { v:1, seeds:[{ name, secret },...] }
//   Ciphertext:    base64( 24-byte nonce || sealed box )
//
// Relay (HTTPS 443):
//   POST {relay}/pair         body: { sessionId, slot, payload }
//   GET  {relay}/pair/{sid}/{slot}  → { payload } | 404
//   Slots: "scan"  – responder posts their base64 X25519 pubKey here
//          "seeds" – initiator posts sealed ciphertext (base64) here
//   Local-first: if localAddr, try GET {localAddr}/pair/{sid}/{slot}
//                with 2 s timeout before each relay attempt.
//   Poll every ~1.5 s; give up after ~90 s.
//
// Roles:
//   Initiator (shows QR): waits for "scan" → ECDH → seals seeds → posts "seeds"
//   Responder (scans QR): posts pubKey to "scan" → polls "seeds" → decrypts → imports
//
// PICK_KEY (com.stellartimelock.wallet.action.PICK_KEY) is unrelated to
// this flow and is not used or changed here.

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import * as ExpoRandom from "expo-crypto";

import {
  listKeyEntries,
  upsertKeyEntry,
  type KeyManagerEntry,
} from "@/src/security/key-manager-store";

// ── Constants ─────────────────────────────────────────────────────────

export const DEFAULT_RELAY = "https://fortress-bot.stellartimelock.workers.dev";
const HKDF_INFO = new TextEncoder().encode("stellar-vault/key-manager-pair/v1");
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 90_000;
const LOCAL_TIMEOUT_MS = 2000;

// ── Types ─────────────────────────────────────────────────────────────

/** JSON payload encoded (base64url) in the pairing QR URI. */
export interface PairOffer {
  v: 1;
  t: "km-pair";
  /** 16 random bytes as 32-char lowercase hex. */
  sessionId: string;
  /** Base64 X25519 public key of the initiator. */
  pubKey: string;
  /** Relay base URL. */
  relay: string;
  /** Optional LAN base URL for direct local attempt. */
  localAddr?: string;
}

/** State maintained by the initiator for the duration of the session. */
export interface InitiatorSession {
  sessionId: string;
  privKey: Uint8Array;
  pubKeyB64: string;
}

export type PairStatus =
  | "idle"
  | "waiting"
  | "exchanging"
  | "importing"
  | "done"
  | "error";

export interface PairResult {
  /** Seeds copied into local Key Manager. */
  imported: number;
  /** Seeds skipped because they were already present. */
  skipped: number;
  /** Total seeds offered by the initiator. */
  total: number;
}

// ── Binary / base64 helpers ───────────────────────────────────────────

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Standard base64url encode (no padding). */
function b64urlEncode(bytes: Uint8Array): string {
  return bytesToB64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/** Decode base64url string to UTF-8 string. */
function b64urlToUtf8(s: string): string {
  // Restore padding and standard base64 chars before calling atob.
  const padded = s + "===".slice((s.length + 3) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

// ── QR URI helpers ────────────────────────────────────────────────────

/** Build the QR string for the initiator's screen. */
export function buildQrUri(offer: PairOffer): string {
  const json = JSON.stringify(offer);
  const d = b64urlEncode(new TextEncoder().encode(json));
  return `stellarvault://kmpair?d=${d}`;
}

/**
 * Parse a scanned QR string. Returns the PairOffer or null if the input
 * is not a valid stellarvault://kmpair URI.
 */
export function parseQrUri(raw: string): PairOffer | null {
  try {
    const trimmed = (raw ?? "").trim();
    if (!/^stellarvault:\/\/kmpair\?/i.test(trimmed)) return null;
    // Replace custom scheme for URL parsing (same trick as sep7.ts).
    const normalized = trimmed.replace(
      /^stellarvault:\/\//i,
      "https://stellarvault.invalid/",
    );
    const url = new URL(normalized);
    const d = url.searchParams.get("d");
    if (!d) return null;
    const json = b64urlToUtf8(d);
    const obj = JSON.parse(json) as Partial<PairOffer>;
    if (
      obj.v !== 1 ||
      obj.t !== "km-pair" ||
      typeof obj.sessionId !== "string" ||
      obj.sessionId.length !== 32 ||
      typeof obj.pubKey !== "string" ||
      obj.pubKey.length < 40 ||
      typeof obj.relay !== "string"
    ) {
      return null;
    }
    return obj as PairOffer;
  } catch {
    return null;
  }
}

// ── Session / keypair generation ──────────────────────────────────────

/**
 * Generate the initiator's session: random sessionId + X25519 keypair.
 * Call this on the device that will show the QR.
 */
export async function generateInitiatorSession(
  relay = DEFAULT_RELAY,
): Promise<{ session: InitiatorSession; offer: PairOffer }> {
  const sidBytes = await ExpoRandom.getRandomBytesAsync(16);
  const sessionId = Array.from(sidBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const privKey = x25519.utils.randomSecretKey();
  const pubKeyBytes = x25519.getPublicKey(privKey);
  const pubKeyB64 = bytesToB64(pubKeyBytes);
  const session: InitiatorSession = { sessionId, privKey, pubKeyB64 };
  const offer: PairOffer = {
    v: 1,
    t: "km-pair",
    sessionId,
    pubKey: pubKeyB64,
    relay,
  };
  return { session, offer };
}

/**
 * Generate the responder's X25519 keypair.
 * Call this after scanning the QR and before posting to the scan slot.
 */
export function generateResponderKeypair(): {
  privKey: Uint8Array;
  pubKeyB64: string;
} {
  const privKey = x25519.utils.randomSecretKey();
  const pubKeyBytes = x25519.getPublicKey(privKey);
  return { privKey, pubKeyB64: bytesToB64(pubKeyBytes) };
}

// ── Crypto helpers ────────────────────────────────────────────────────

/**
 * X25519 ECDH + HKDF-SHA-256.
 * Both sides call this with their own privKey and the other side's pubKeyB64.
 * The result is the same 32-byte symmetric key on both sides.
 */
function deriveSymmetricKey(
  myPrivKey: Uint8Array,
  theirPubKeyB64: string,
): Uint8Array {
  const theirPubKey = b64ToBytes(theirPubKeyB64);
  const sharedSecret = x25519.getSharedSecret(myPrivKey, theirPubKey);
  return hkdf(sha256, sharedSecret, undefined, HKDF_INFO, 32);
}

/**
 * Encrypt the seed list for transit.
 * Returns base64( 24-byte nonce || XChaCha20-Poly1305 ciphertext+tag ).
 */
async function sealSeeds(
  key: Uint8Array,
  seeds: Array<{ name: string; secret: string }>,
): Promise<string> {
  const box = JSON.stringify({ v: 1, seeds });
  const plaintext = new TextEncoder().encode(box);
  const nonce = await ExpoRandom.getRandomBytesAsync(24);
  const sealed = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const combined = new Uint8Array(24 + sealed.length);
  combined.set(nonce, 0);
  combined.set(sealed, 24);
  return bytesToB64(combined);
}

/**
 * Decrypt and validate a sealed seed payload.
 * Throws on decryption failure or malformed box.
 */
function openSeeds(
  key: Uint8Array,
  payloadB64: string,
): Array<{ name: string; secret: string }> {
  const combined = b64ToBytes(payloadB64);
  if (combined.length < 25) throw new Error("payload_too_short");
  const nonce = combined.slice(0, 24);
  const sealed = combined.slice(24);
  const plaintext = xchacha20poly1305(key, nonce).decrypt(sealed);
  const box = JSON.parse(new TextDecoder().decode(plaintext)) as {
    v: number;
    seeds: Array<{ name: string; secret: string }>;
  };
  if (box.v !== 1 || !Array.isArray(box.seeds)) throw new Error("invalid_box");
  return box.seeds;
}

// ── Relay HTTP helpers ────────────────────────────────────────────────

/** GET a relay slot. Returns payload string on success, null on 404/error. */
async function tryGetSlot(
  base: string,
  sessionId: string,
  slot: string,
  timeoutMs?: number,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }
    const res = await fetch(
      `${base}/pair/${sessionId}/${slot}`,
      { signal: controller.signal },
    );
    if (timer) clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = (await res.json()) as { payload: string };
    return data.payload ?? null;
  } catch {
    return null;
  }
}

/** POST a payload to a relay slot. Throws on server error. */
async function postSlot(
  relay: string,
  sessionId: string,
  slot: string,
  payload: string,
): Promise<void> {
  const res = await fetch(`${relay}/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, slot, payload }),
  });
  if (!res.ok) throw new Error(`relay_post_${res.status}`);
}

/**
 * Poll until a slot is filled or the timeout expires.
 * Tries localAddr first (2 s) on each cycle if present, then the relay.
 * Polls every ~1.5 s, gives up at ~90 s.
 */
async function pollSlot(
  relay: string,
  sessionId: string,
  slot: string,
  signal: AbortSignal,
  localAddr?: string,
): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < deadline) {
    if (localAddr) {
      const local = await tryGetSlot(localAddr, sessionId, slot, LOCAL_TIMEOUT_MS);
      if (local !== null) return local;
    }
    const remote = await tryGetSlot(relay, sessionId, slot);
    if (remote !== null) return remote;
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(signal.aborted ? "aborted" : "poll_timeout");
}

// ── Import helpers ────────────────────────────────────────────────────

async function importSeeds(
  seeds: Array<{ name: string; secret: string }>,
): Promise<{ imported: number; skipped: number }> {
  const local = await listKeyEntries();
  const localSeeds = new Set(
    local.map((e: KeyManagerEntry) => (e.secretSeed ?? "").trim().toUpperCase()),
  );
  let imported = 0;
  let skipped = 0;
  for (const s of seeds) {
    const secret = (s.secret ?? "").trim().toUpperCase();
    if (!secret) continue;
    if (localSeeds.has(secret)) {
      skipped++;
      continue;
    }
    try {
      await upsertKeyEntry({
        label: (s.name || "Imported").trim().slice(0, 48),
        secretSeed: secret,
        publicAddress: "",
      });
      localSeeds.add(secret);
      imported++;
    } catch {
      skipped++;
    }
  }
  return { imported, skipped };
}

// ── Session runners ───────────────────────────────────────────────────

/**
 * Run the initiator side of a pairing session.
 * The initiator shows the QR, waits for the responder's pubKey in the
 * "scan" slot, then seals its Key Manager seeds and posts them to "seeds".
 */
export async function runInitiator(
  session: InitiatorSession,
  offer: PairOffer,
  onStatus: (s: PairStatus) => void,
  onResult: (r: PairResult) => void,
  onError: (msg: string) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    onStatus("waiting");

    // Wait for responder to post their pubKey.
    const respPubKeyB64 = await pollSlot(
      offer.relay,
      offer.sessionId,
      "scan",
      signal,
      offer.localAddr,
    );
    if (signal.aborted) return;

    onStatus("exchanging");

    // ECDH + HKDF → symmetric key.
    const key = deriveSymmetricKey(session.privKey, respPubKeyB64);

    // Read and seal this device's Key Manager entries.
    const entries = await listKeyEntries();
    const seeds = entries.map((e: KeyManagerEntry) => ({
      name: e.label,
      secret: e.secretSeed,
    }));
    const payloadB64 = await sealSeeds(key, seeds);

    // Post sealed seeds to relay.
    await postSlot(offer.relay, offer.sessionId, "seeds", payloadB64);

    onStatus("done");
    onResult({ imported: 0, skipped: 0, total: seeds.length });
  } catch (e) {
    if ((e as Error).message === "aborted") return;
    const isTimeout = (e as Error).message === "poll_timeout";
    onError(
      isTimeout
        ? "Timed out waiting for the other device. Make sure both devices have a network connection and try again."
        : "Pairing failed. Please try again.",
    );
    onStatus("error");
  }
}

/**
 * Run the responder side of a pairing session.
 * The responder scanned the QR, posts its pubKey to the "scan" slot,
 * then polls for the sealed seeds, decrypts, and imports them.
 */
export async function runResponder(
  privKey: Uint8Array,
  pubKeyB64: string,
  offer: PairOffer,
  onStatus: (s: PairStatus) => void,
  onResult: (r: PairResult) => void,
  onError: (msg: string) => void,
  signal: AbortSignal,
): Promise<void> {
  try {
    // Post responder's pubKey so initiator can proceed.
    await postSlot(offer.relay, offer.sessionId, "scan", pubKeyB64);
    if (signal.aborted) return;

    onStatus("waiting");

    // Wait for initiator to post sealed seeds.
    const payloadB64 = await pollSlot(
      offer.relay,
      offer.sessionId,
      "seeds",
      signal,
      offer.localAddr,
    );
    if (signal.aborted) return;

    onStatus("importing");

    // ECDH + HKDF → symmetric key (uses initiator's pubKey from the offer).
    const key = deriveSymmetricKey(privKey, offer.pubKey);

    // Decrypt seed box.
    const seeds = openSeeds(key, payloadB64);

    // Import, skipping seeds already present.
    const { imported, skipped } = await importSeeds(seeds);

    onStatus("done");
    onResult({ imported, skipped, total: seeds.length });
  } catch (e) {
    if ((e as Error).message === "aborted") return;
    const isTimeout = (e as Error).message === "poll_timeout";
    onError(
      isTimeout
        ? "Timed out waiting for seeds. Make sure the other device is online and try again."
        : "Pairing failed. Please try again.",
    );
    onStatus("error");
  }
}
