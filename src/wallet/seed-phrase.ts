// BIP-39 + SEP-0005 helpers for Stellar seed phrases.
//
// Flow: mnemonic → BIP-39 seed → SLIP-0010 ed25519 path m/44'/148'/0'
// → raw 32-byte seed → existing S… / G… StrKey encoding.
// The derived S… secret then follows the same wallet-book / keystore
// path as a manually pasted secret seed.

import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  entropyToMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as Crypto from "expo-crypto";

import {
  encodeEd25519PublicKey,
  encodeEd25519SecretSeed,
} from "./strkey";

export type SeedStrength = 12 | 24;

export interface PhraseKeypair {
  publicKey: string; // G...
  secretSeed: string; // S...
}

const HARDENED = 0x80000000;
/** Stellar SEP-0005 primary account path: m/44'/148'/0' */
const STELLAR_ACCOUNT_INDEX = 0;

export class InvalidMnemonicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMnemonicError";
  }
}

/** Generate a BIP-39 mnemonic (12 or 24 words) using expo-crypto CSPRNG. */
export async function generateSeedPhrase(
  strength: SeedStrength = 12,
): Promise<string> {
  const entropyBytes = strength === 12 ? 16 : 32;
  const bytes = await Crypto.getRandomBytesAsync(entropyBytes);
  return entropyToMnemonic(bytes, wordlist);
}

export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

export function isValidMnemonic(phrase: string): boolean {
  return validateMnemonic(normalizeMnemonic(phrase), wordlist);
}

export function mnemonicWords(phrase: string): string[] {
  return normalizeMnemonic(phrase).split(" ");
}

/** True when input looks like a 12/24-word BIP-39 phrase (shape only). */
export function looksLikeMnemonic(raw: string): boolean {
  const words = normalizeMnemonic(raw).split(" ").filter(Boolean);
  return (
    (words.length === 12 || words.length === 24) &&
    words.every((w) => /^[a-z]+$/.test(w))
  );
}

type SlipNode = { key: Uint8Array; chainCode: Uint8Array };

function slip10Master(seed: Uint8Array): SlipNode {
  const I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function slip10Child(node: SlipNode, index: number): SlipNode {
  const data = new Uint8Array(37);
  data[0] = 0;
  data.set(node.key, 1);
  data[33] = (index >>> 24) & 0xff;
  data[34] = (index >>> 16) & 0xff;
  data[35] = (index >>> 8) & 0xff;
  data[36] = index & 0xff;
  const I = hmac(sha512, node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

/** Derive the raw 32-byte ed25519 seed for SEP-0005 path m/44'/148'/account'. */
export function deriveRawSeedFromMnemonic(
  phrase: string,
  accountIndex: number = STELLAR_ACCOUNT_INDEX,
  passphrase: string = "",
): Uint8Array {
  const normalized = normalizeMnemonic(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new InvalidMnemonicError(
      "Invalid recovery phrase. Check the words and try again.",
    );
  }
  const bip39Seed = mnemonicToSeedSync(normalized, passphrase);
  let node = slip10Master(bip39Seed);
  node = slip10Child(node, HARDENED + 44);
  node = slip10Child(node, HARDENED + 148);
  node = slip10Child(node, HARDENED + (accountIndex >>> 0));
  return node.key;
}

/**
 * Recover a Stellar keypair from a BIP-39 mnemonic (SEP-0005).
 * Returns the same `{ publicKey, secretSeed }` shape as `keypairFromSecretSeed`
 * so callers can feed `secretSeed` into the existing wallet-book flow.
 */
export function keypairFromMnemonic(
  phrase: string,
  accountIndex: number = STELLAR_ACCOUNT_INDEX,
  passphrase: string = "",
): PhraseKeypair {
  const raw = deriveRawSeedFromMnemonic(phrase, accountIndex, passphrase);
  const pub = ed25519.getPublicKey(raw);
  return {
    publicKey: encodeEd25519PublicKey(pub),
    secretSeed: encodeEd25519SecretSeed(raw),
  };
}
