import assert from "node:assert/strict";
import { describe, it } from "node:test";

import CryptoJS from "crypto-js";

import {
  rawSigningKeyHexFromSecretSeed,
  secretSeedFromRawSigningKeyHex,
  unwrapSigningKeyHex,
  wrapSigningKeyHex,
} from "../src/security/derived-signing-key-crypto.ts";
import { encodeEd25519SecretSeed } from "../src/wallet/strkey.ts";

describe("derived signing key wrap", () => {
  const raw = new Uint8Array(32);
  raw[0] = 7;
  raw[31] = 9;
  const seed = encodeEd25519SecretSeed(raw);

  it("round-trips S… through the 32-byte hex without storing the seed string", () => {
    const hex = rawSigningKeyHexFromSecretSeed(seed);
    assert.equal(hex.length, 64);
    assert.equal(secretSeedFromRawSigningKeyHex(hex), seed);
    assert.notEqual(hex.toUpperCase(), seed);
  });

  it("wraps and unwraps with an AES key", () => {
    const hex = rawSigningKeyHexFromSecretSeed(seed);
    const aes = CryptoJS.enc.Hex.parse("11".repeat(32));
    const wrapped = wrapSigningKeyHex(hex, aes);
    assert.equal(wrapped.split(".").length, 3);
    assert.equal(unwrapSigningKeyHex(wrapped, aes), hex);
    const other = CryptoJS.enc.Hex.parse("22".repeat(32));
    assert.equal(unwrapSigningKeyHex(wrapped, other), null);
  });
});
