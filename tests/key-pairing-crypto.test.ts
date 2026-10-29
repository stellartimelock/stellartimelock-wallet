import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

const require = createRequire(import.meta.url);
const pairingSrc = readFileSync("src/security/key-pairing.ts", "utf8");

describe("Key Manager pairing noble imports", () => {
  it("does not import the v2-removed @noble/curves/x25519 path", () => {
    assert.doesNotMatch(pairingSrc, /from ["']@noble\/curves\/x25519["']/);
    assert.match(pairingSrc, /from ["']@noble\/curves\/ed25519\.js["']/);
    assert.match(pairingSrc, /from ["']@noble\/hashes\/hkdf\.js["']/);
    assert.match(pairingSrc, /from ["']@noble\/hashes\/sha2\.js["']/);
    assert.match(pairingSrc, /from ["']@noble\/ciphers\/chacha\.js["']/);
  });

  it("resolves the pairing noble entry points", () => {
    assert.ok(require.resolve("@noble/curves/ed25519.js"));
    assert.ok(require.resolve("@noble/hashes/hkdf.js"));
    assert.ok(require.resolve("@noble/hashes/sha2.js"));
    assert.ok(require.resolve("@noble/ciphers/chacha.js"));
    assert.throws(
      () => require.resolve("@noble/curves/x25519"),
      { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
    );
  });

  it("derives the same X25519 + HKDF key on both sides and opens a sealed box", () => {
    const alice = x25519.keygen();
    const bob = x25519.keygen();
    const info = new TextEncoder().encode("stellar-vault/key-manager-pair/v1");
    const aliceKey = hkdf(
      sha256,
      x25519.getSharedSecret(alice.secretKey, bob.publicKey),
      undefined,
      info,
      32,
    );
    const bobKey = hkdf(
      sha256,
      x25519.getSharedSecret(bob.secretKey, alice.publicKey),
      undefined,
      info,
      32,
    );
    assert.deepEqual(aliceKey, bobKey);

    const nonce = new Uint8Array(24).fill(7);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({ v: 1, seeds: [{ name: "test", secret: "S" + "A".repeat(55) }] }),
    );
    const sealed = xchacha20poly1305(aliceKey, nonce).encrypt(plaintext);
    const opened = xchacha20poly1305(bobKey, nonce).decrypt(sealed);
    assert.deepEqual(opened, plaintext);
  });
});
