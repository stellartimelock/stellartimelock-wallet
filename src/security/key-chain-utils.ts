// Multi-chain key utilities for Key Manager.
//
// Covers address derivation, key format validation, and balance lookup for
// each supported chain type.  Only uses packages already in the project —
// @noble/curves (secp256k1, ed25519) and @noble/hashes (sha256).  Chains
// that need keccak or RIPEMD-160 fall back to manual address entry.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

// ---------------------------------------------------------------------------
// Chain types
// ---------------------------------------------------------------------------

export type KeyChain = "stellar" | "sol" | "btc" | "eth" | "other";

export interface ChainMeta {
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  addressLabel: string;
  addressPlaceholder: string;
  /** Whether this chain can auto-derive the public address from the private key. */
  canAutoDeriveAddress: boolean;
  /** Whether we can look up a balance for a known public address. */
  canLookUpBalance: boolean;
}

export const CHAIN_META: Record<KeyChain, ChainMeta> = {
  stellar: {
    label: "Stellar (XLM)",
    keyLabel: "Secret Seed (S…)",
    keyPlaceholder: "S… (56 characters)",
    addressLabel: "Public Address",
    addressPlaceholder: "G… (auto-derived from seed)",
    canAutoDeriveAddress: true,
    canLookUpBalance: true,
  },
  sol: {
    label: "Solana (SOL)",
    keyLabel: "Private Key (hex or base58)",
    keyPlaceholder: "64-char hex or base58 seed",
    addressLabel: "Public Address (base58)",
    addressPlaceholder: "Auto-derived, or paste manually",
    canAutoDeriveAddress: true,
    canLookUpBalance: true,
  },
  btc: {
    label: "Bitcoin (BTC)",
    keyLabel: "Private Key (WIF or hex)",
    keyPlaceholder: "WIF (51–52 chars) or 64-char hex",
    addressLabel: "Bitcoin Address",
    addressPlaceholder: "bc1… / 1… / 3… (enter manually)",
    canAutoDeriveAddress: false,
    canLookUpBalance: true,
  },
  eth: {
    label: "Ethereum / EVM",
    keyLabel: "Private Key (hex)",
    keyPlaceholder: "0x… or 64-char hex",
    addressLabel: "Wallet Address",
    addressPlaceholder: "0x… (enter manually)",
    canAutoDeriveAddress: false,
    canLookUpBalance: true,
  },
  other: {
    label: "Other chain",
    keyLabel: "Private Key",
    keyPlaceholder: "Paste your private key",
    addressLabel: "Public Address",
    addressPlaceholder: "Paste your public address",
    canAutoDeriveAddress: false,
    canLookUpBalance: false,
  },
};

export const CHAIN_ORDER: KeyChain[] = ["stellar", "sol", "btc", "eth", "other"];

// ---------------------------------------------------------------------------
// Base58 encode / decode (minimal, no checksum)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let result = "";
  while (n > 0n) {
    const rem = Number(n % 58n);
    result = BASE58_ALPHABET[rem] + result;
    n = n / 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = "1" + result;
  }
  return result;
}

function base58Decode(s: string): Uint8Array | null {
  try {
    let n = 0n;
    for (const c of s) {
      const idx = BASE58_ALPHABET.indexOf(c);
      if (idx < 0) return null;
      n = n * 58n + BigInt(idx);
    }
    const hex = n.toString(16).padStart(2, "0");
    const bytes = Buffer.from(hex.length % 2 === 0 ? hex : "0" + hex, "hex");
    const leadingZeros = new Uint8Array(s.match(/^1+/)?.[0].length ?? 0);
    return new Uint8Array([...leadingZeros, ...bytes]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SOL key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a Solana public key (base58) from a 32-byte or 64-byte private key.
 * Accepts: 64-char hex (32-byte scalar), 128-char hex (64-byte keypair), or
 * base58-encoded variants.
 */
export function deriveSolPublicKey(privateKey: string): string | null {
  try {
    const trimmed = privateKey.trim();

    let seed: Uint8Array | null = null;

    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      // 32-byte hex
      seed = new Uint8Array(Buffer.from(trimmed, "hex"));
    } else if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
      // 64-byte hex (full keypair — first 32 bytes are the seed)
      seed = new Uint8Array(Buffer.from(trimmed.slice(0, 64), "hex"));
    } else {
      // Try base58 — could be 32 bytes (44 chars) or 64 bytes (88 chars)
      const decoded = base58Decode(trimmed);
      if (!decoded) return null;
      if (decoded.length === 32) {
        seed = decoded;
      } else if (decoded.length === 64) {
        // Full keypair; first 32 bytes are the seed
        seed = decoded.slice(0, 32);
      } else {
        return null;
      }
    }

    if (!seed || seed.length !== 32) return null;
    const pubBytes = ed25519.getPublicKey(seed);
    return base58Encode(pubBytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ETH key derivation (secp256k1 → compressed public key hex, no keccak)
// ---------------------------------------------------------------------------

/**
 * From an ETH hex private key, derive the secp256k1 compressed public key.
 * Returns a "0x04…" uncompressed public key hex — NOT an EIP-55 checksum address,
 * since that requires keccak which isn't in the project.  The UI should explain
 * that the user must paste the address manually.
 */
export function deriveEthPublicKeyHex(privateKey: string): string | null {
  try {
    let hex = privateKey.trim().toLowerCase();
    if (hex.startsWith("0x")) hex = hex.slice(2);
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    const privBytes = new Uint8Array(Buffer.from(hex, "hex"));
    const pubBytes = secp256k1.getPublicKey(privBytes, false); // uncompressed
    return "0x" + Buffer.from(pubBytes).toString("hex");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BTC key validation (WIF / hex) — no address derivation (needs RIPEMD-160)
// ---------------------------------------------------------------------------

export function isValidBtcKey(key: string): boolean {
  const trimmed = key.trim();
  // WIF uncompressed: starts with 5, 51 chars
  // WIF compressed: starts with K or L, 52 chars
  if (/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)) return true;
  // Raw hex 64 chars
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function isValidSolKey(key: string): boolean {
  return deriveSolPublicKey(key) !== null;
}

export function isValidEthKey(key: string): boolean {
  let hex = key.trim().toLowerCase();
  if (hex.startsWith("0x")) hex = hex.slice(2);
  return /^[0-9a-f]{64}$/.test(hex);
}

export function isValidKeyForChain(chain: KeyChain, key: string): boolean {
  if (!key.trim()) return false;
  switch (chain) {
    case "sol": return isValidSolKey(key);
    case "btc": return isValidBtcKey(key);
    case "eth": return isValidEthKey(key);
    case "other": return key.trim().length > 0;
    default: return false; // stellar handled separately in key-manager-store
  }
}

/**
 * Try to derive the public address from a private key for chains that support it.
 * Returns null when derivation isn't possible or the key is invalid.
 */
export function deriveAddressForChain(chain: KeyChain, privateKey: string): string | null {
  switch (chain) {
    case "sol": return deriveSolPublicKey(privateKey);
    case "eth":
    case "btc":
    case "other":
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Balance lookup
// ---------------------------------------------------------------------------

export interface ChainBalance {
  raw: string;
  usd?: number;
  error?: string;
}

/** Fetch the on-chain balance for a public address on the given chain. */
export async function fetchChainBalance(
  chain: KeyChain,
  publicAddress: string,
): Promise<ChainBalance> {
  const addr = publicAddress.trim();
  if (!addr) return { raw: "—" };

  switch (chain) {
    case "sol": {
      try {
        const res = await fetch("https://api.mainnet-beta.solana.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [addr, { commitment: "finalized" }],
          }),
        });
        const json = (await res.json()) as {
          result?: { value: number };
          error?: { message: string };
        };
        if (json.error) return { raw: "—", error: json.error.message };
        const lamports = json.result?.value ?? 0;
        const sol = lamports / 1_000_000_000;
        return { raw: `${sol.toFixed(4)} SOL` };
      } catch (e) {
        return { raw: "—", error: String(e) };
      }
    }

    case "btc": {
      try {
        const res = await fetch(
          `https://blockstream.info/api/address/${encodeURIComponent(addr)}`,
        );
        const json = (await res.json()) as {
          chain_stats?: { funded_txo_sum: number; spent_txo_sum: number };
          error?: string;
        };
        if (json.error || !json.chain_stats) return { raw: "—", error: json.error };
        const satoshis =
          json.chain_stats.funded_txo_sum - json.chain_stats.spent_txo_sum;
        const btc = satoshis / 100_000_000;
        return { raw: `${btc.toFixed(8)} BTC` };
      } catch (e) {
        return { raw: "—", error: String(e) };
      }
    }

    case "eth": {
      try {
        const res = await fetch("https://cloudflare-eth.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [addr, "latest"],
            id: 1,
          }),
        });
        const json = (await res.json()) as {
          result?: string;
          error?: { message: string };
        };
        if (json.error || !json.result) return { raw: "—", error: json.error?.message };
        const wei = BigInt(json.result);
        const eth = Number(wei) / 1e18;
        return { raw: `${eth.toFixed(6)} ETH` };
      } catch (e) {
        return { raw: "—", error: String(e) };
      }
    }

    default:
      return { raw: "—" };
  }
}
