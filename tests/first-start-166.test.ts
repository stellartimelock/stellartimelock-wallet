import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import CryptoJS from "crypto-js";

import {
  PBKDF2_YIELD_EVERY,
  decryptBackup,
  encryptV3Async,
  pbkdf2Async,
} from "../src/security/backup-crypto.ts";

function words(text: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Utf8.parse(text);
}

describe("1.6.6 first-start Key Manager open", () => {
  it("yields a PBKDF2 that matches CryptoJS byte for byte", async () => {
    const password = words("wallet-seed");
    const salt = words("first-start-16b!");
    const iterations = PBKDF2_YIELD_EVERY + 500;
    const sha256 = await pbkdf2Async(password, salt, iterations, 64, true);
    const sha256Sync = CryptoJS.PBKDF2(password, salt, {
      keySize: 16,
      iterations,
      hasher: CryptoJS.algo.SHA256,
    });
    assert.equal(sha256.toString(CryptoJS.enc.Hex), sha256Sync.toString(CryptoJS.enc.Hex));

    const sha1 = await pbkdf2Async(password, salt, iterations, 32, false);
    const sha1Sync = CryptoJS.PBKDF2(password, salt, {
      keySize: 8,
      iterations,
      hasher: CryptoJS.algo.SHA1,
    });
    assert.equal(sha1.toString(CryptoJS.enc.Hex), sha1Sync.toString(CryptoJS.enc.Hex));
  });

  it("opens a yielded v3 ciphertext with the synchronous decrypt", async () => {
    const seed = "SSECRETSEEDFORTESTSXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    const iv = Uint8Array.from({ length: 16 }, (_, i) => i + 3);
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 9);
    const plain = JSON.stringify([{ id: "km", secretSeed: "SABC" }]);
    const sealed = await encryptV3Async(plain, seed, iv, salt);
    assert.equal(decryptBackup(sealed, seed), plain);
    assert.equal(decryptBackup(sealed, "SOTHERSEEDFORTESTSXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"), "");
  });

  it("backs up plaintext before the live save is replaced", () => {
    const source = readFileSync("src/security/key-manager-at-rest.ts", "utf8");
    const backup = source.indexOf("await io.backupPlaintext(live)");
    const write = source.indexOf("await io.writeLive(sealed)");
    assert.ok(backup > 0 && write > backup);
    const store = readFileSync("src/security/key-manager-store.ts", "utf8");
    assert.match(store, /sessionCache/);
    assert.match(store, /subscribeKeyManagerUpdating/);
    assert.match(store, /pbkdf2Async|sealKeyManagerPayloadAsync|runKeyManagerMigration/);
  });
});
