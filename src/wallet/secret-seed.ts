// Pure S… secret-seed parser. No storage and no Expo, so restore tests
// can derive an account without starting React Native.

import { ed25519 } from "@noble/curves/ed25519.js";

import {
  decodeStrKey,
  encodeEd25519PublicKey,
  encodeEd25519SecretSeed,
} from "./strkey";

// SEP-0023 version byte for secret seeds. Matches strkey.ts.
const SECRET_SEED_VERSION = 18 << 3;

export interface StellarKeypair {
  publicKey: string;
  secretSeed: string;
}

export class InvalidSecretSeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSecretSeedError";
  }
}

/**
 * Recover a keypair from a `S...` secret seed.
 * Throws `InvalidSecretSeedError` for anything that isn't a valid 56-char S-StrKey.
 */
export function keypairFromSecretSeed(rawSecret: string): StellarKeypair {
  const secret = (rawSecret ?? "").trim().toUpperCase();
  if (secret.length !== 56 || !secret.startsWith("S")) {
    throw new InvalidSecretSeedError("Secret seed must be 56 characters and start with S.");
  }
  let decoded;
  try {
    decoded = decodeStrKey(secret);
  } catch (e) {
    throw new InvalidSecretSeedError(
      `Invalid secret seed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (decoded.version !== SECRET_SEED_VERSION) {
    throw new InvalidSecretSeedError("Not a Stellar Ed25519 secret seed.");
  }
  const pub = ed25519.getPublicKey(decoded.payload);
  return {
    publicKey: encodeEd25519PublicKey(pub),
    secretSeed: secret,
  };
}

export function keypairFromRawSeed(seed: Uint8Array): StellarKeypair {
  const pub = ed25519.getPublicKey(seed);
  return {
    publicKey: encodeEd25519PublicKey(pub),
    secretSeed: encodeEd25519SecretSeed(seed),
  };
}
