import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import CryptoJS from "crypto-js";

import { pbkdf2Async } from "../src/security/backup-crypto.ts";

function readSrc(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("1.6.24 export finishes with a file or a lasting error", () => {
  it("async PBKDF2 matches CryptoJS.PBKDF2 byte-for-byte (SHA-256, 64-byte key)", async () => {
    const password = CryptoJS.enc.Utf8.parse("stl-export-kdf-compat-check");
    const salt = CryptoJS.enc.Hex.parse("00112233445566778899aabbccddeeff");
    const iterations = 2_000;
    const expected = CryptoJS.PBKDF2(password, salt, {
      keySize: 16,
      iterations,
      hasher: CryptoJS.algo.SHA256,
    });
    const actual = await pbkdf2Async(password, salt, iterations, 64, true);
    assert.equal(actual.toString(), expected.toString());
    assert.equal(actual.sigBytes, 64);
  });

  it("async PBKDF2 matches CryptoJS.PBKDF2 for SHA-1 as well", async () => {
    const password = CryptoJS.enc.Utf8.parse("stl-export-kdf-compat-check");
    const salt = CryptoJS.enc.Hex.parse("ffeeddccbbaa99887766554433221100");
    const iterations = 1_000;
    const expected = CryptoJS.PBKDF2(password, salt, {
      keySize: 8,
      iterations,
      hasher: CryptoJS.algo.SHA1,
    });
    const actual = await pbkdf2Async(password, salt, iterations, 32, false);
    assert.equal(actual.toString(), expected.toString());
    assert.equal(actual.sigBytes, 32);
  });

  it("pbkdf2Async prefers Web Crypto or noble hashes over the slow CryptoJS loop", () => {
    const body = readSrc("../src/security/backup-crypto.ts");
    assert.match(body, /crypto\.subtle/);
    assert.match(body, /noblePbkdf2Async/);
    assert.match(body, /PBKDF2_YIELD_EVERY = 20_000/);
    assert.match(body, /deriveBits/);
  });

  it("export UI keeps a lasting error after encrypt or the folder write fails", () => {
    const body = readSrc("../src/utils/manual-backup/ManualBackupCard.tsx");
    assert.match(body, /exportError/);
    assert.match(body, /manual-backup-export-error/);
    assert.match(body, /setExportError\(msg\)/);
    assert.match(body, /catch \{/);
    assert.match(body, /getCurrentAndroidSaveFolderLabel/);
  });

  it("public encrypt\(\) still uses the async v3 seal", () => {
    const body = readSrc("../src/security/crypto.ts");
    assert.match(body, /return encryptV3Async\(/);
    assert.equal(body.includes("return encryptV3("), false);
  });
});
