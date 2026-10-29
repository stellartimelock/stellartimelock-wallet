import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import CryptoJS from "crypto-js";

import {
  PBKDF2_YIELD_EVERY,
  decryptBackup,
  encryptV1,
  encryptV2,
  encryptV3,
  encryptV3Async,
  pbkdf2Async,
} from "../src/security/backup-crypto.ts";
import { utf8ToMutableBytes } from "../src/security/secure-wipe.ts";
import {
  classifyPickedBackup,
  decryptFailedMessage,
  openClassifiedBackup,
} from "../src/utils/manual-backup/classify-picked-file.ts";

const SEED = "SSECRETSEEDFORTESTS";
const IV = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i + 16);
const PLAIN = "{\"v\":1,\"hello\":\"world\"}";
/** Ciphertext from sync encryptV3 (the 1.6.5 derivation). iv 1..16, salt 16..31. */
const FROZEN_V3 =
  "v3.EBESExQVFhcYGRobHB0eHw==.AQIDBAUGBwgJCgsMDQ4PEA==.bIuO9FHiVUm65yOp+U0UXetXalC3gMAChgL0wYv53Rw=.RssAxyUJV9WZHgk8/JLPxPAbvV7eEL1CaWxjLgZH7Jo=";

function words(text: string): CryptoJS.lib.WordArray {
  return CryptoJS.enc.Utf8.parse(text);
}

function hex(value: CryptoJS.lib.WordArray, bytes: number): string {
  return value.toString(CryptoJS.enc.Hex).slice(0, bytes * 2);
}

async function expectPbkdf2(
  password: string,
  salt: string,
  iterations: number,
  bytes: number,
  sha256: boolean,
  expected: string,
): Promise<void> {
  const derived = await pbkdf2Async(words(password), words(salt), iterations, bytes, sha256);
  const sync = CryptoJS.PBKDF2(words(password), words(salt), {
    keySize: bytes / 4,
    iterations,
    hasher: sha256 ? CryptoJS.algo.SHA256 : CryptoJS.algo.SHA1,
  });
  assert.equal(hex(derived, bytes), expected);
  assert.equal(hex(sync, bytes), expected);
  assert.equal(hex(derived, bytes), hex(sync, bytes));
}

function wrap(payload: string): string {
  return JSON.stringify({
    format: "stellar-timelock-backup",
    v: 1,
    payload,
  });
}

describe("1.6.7 restore and PBKDF2", () => {
  it("matches RFC 6070 SHA1 and RFC 7914 SHA256, including a second block", async () => {
    await expectPbkdf2(
      "password",
      "salt",
      1,
      20,
      false,
      "0c60c80f961f0e71f3a9b524af6012062fe037a6",
    );
    await expectPbkdf2(
      "password",
      "salt",
      2,
      20,
      false,
      "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957",
    );
    await expectPbkdf2(
      "password",
      "salt",
      4096,
      20,
      false,
      "4b007901b765489abead49d926f721d065a429c1",
    );
    await expectPbkdf2(
      "password",
      "salt",
      1,
      32,
      true,
      "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
    );
    await expectPbkdf2(
      "passwd",
      "salt",
      1,
      64,
      true,
      "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783",
    );
    const once = await pbkdf2Async(words("password"), words("salt"), 1, 20, false);
    const twice = await pbkdf2Async(words("password"), words("salt"), 2, 20, false);
    assert.notEqual(hex(once, 20), hex(twice, 20));
  });

  it("yields on the iteration count the RFC uses, and encodes the seed as UTF-8", async () => {
    const iterations = PBKDF2_YIELD_EVERY + 1;
    const yielded = await pbkdf2Async(words("password"), words("salt"), iterations, 32, true);
    const sync = CryptoJS.PBKDF2(words("password"), words("salt"), {
      keySize: 8,
      iterations,
      hasher: CryptoJS.algo.SHA256,
    });
    assert.equal(yielded.toString(CryptoJS.enc.Hex), sync.toString(CryptoJS.enc.Hex));
    const bytes = utf8ToMutableBytes("pass\0word");
    assert.equal(bytes[4], 0);
    assert.equal(String.fromCharCode(...bytes.subarray(0, 9)), "pass\0word");
  });

  it("opens a frozen 1.6.5 v3 file, and a 1.6.6 yielded seal, with sync decrypt", async () => {
    assert.equal(encryptV3(PLAIN, SEED, IV, SALT), FROZEN_V3);
    assert.equal(await encryptV3Async(PLAIN, SEED, IV, SALT), FROZEN_V3);
    assert.equal(decryptBackup(FROZEN_V3, SEED), PLAIN);
    assert.equal(decryptBackup(FROZEN_V3, "SOTHER"), "");

    const v1 = wrap(encryptV1(PLAIN, SEED, IV));
    const v2 = wrap(encryptV2(PLAIN, SEED, IV));
    const v3 = `\uFEFF${JSON.stringify(wrap(FROZEN_V3))}`;
    for (const [name, raw] of [
      ["sha1-v1-helper.stvault", v1],
      ["sha1-v2-helper.os", v2],
      ["from-1.6.5.stvault", v3],
    ] as const) {
      const opened = await openClassifiedBackup(name, raw, SEED, decryptBackup);
      assert.equal(opened.ok, true);
      if (opened.ok) assert.equal(opened.plaintext, PLAIN);
    }
    const wrong = await openClassifiedBackup("from-1.6.5.stvault", wrap(FROZEN_V3), "SOTHER", decryptBackup);
    assert.equal(wrong.ok, false);
    if (!wrong.ok) {
      assert.equal(wrong.tone, "error");
      assert.equal(wrong.error, decryptFailedMessage("from-1.6.5.stvault", 3));
      assert.match(wrong.error, /Decryption failed for .*from-1\.6\.5\.stvault/);
      assert.match(wrong.error, /cipher v3/);
      assert.match(wrong.error, /This seed does not open it/);
    }
  });

  it("names a Key Manager or Fortress file and does not call that a failed decrypt", () => {
    const sealed = classifyPickedBackup("key-manager.json", FROZEN_V3);
    assert.equal(sealed.kind, "not-wallet");
    if (sealed.kind === "not-wallet") {
      assert.match(sealed.message, /key-manager\.json/);
      assert.match(sealed.message, /Key Manager save/);
      assert.doesNotMatch(sealed.message, /Decryption failed/);
    }
    const list = classifyPickedBackup(
      "key-manager.plaintext.bak",
      JSON.stringify([{ id: "a", secretSeed: "SABC" }]),
    );
    assert.equal(list.kind, "not-wallet");
    if (list.kind === "not-wallet") assert.match(list.message, /Key Manager list/);
    const fortress = classifyPickedBackup(
      "vault.json",
      JSON.stringify({ format: "stellar-fortress-backup", payload: "v3.nope" }),
    );
    assert.equal(fortress.kind, "not-wallet");
    if (fortress.kind === "not-wallet") {
      assert.match(fortress.message, /Fortress/);
      assert.match(fortress.message, /vault\.json/);
    }
    const notes = classifyPickedBackup("notes.txt", "hello");
    assert.equal(notes.kind, "not-wallet");
    if (notes.kind === "not-wallet") assert.match(notes.message, /not a Stellar TimeLock wallet backup/);
  });

  it("keeps restore on the synchronous seed derivation and does not rewrite files", () => {
    const source = readFileSync("src/utils/manual-backup/manual-backup.ts", "utf8");
    const start = source.indexOf("export async function restoreManualBackupPayload");
    const end = source.indexOf("export async function importManualBackup");
    const body = source.slice(start, end);
    assert.match(body, /openClassifiedBackup/);
    assert.match(body, /decrypt\)/);
    assert.doesNotMatch(body, /decryptBackupAsync|pbkdf2Async|sessionCache|deleteAsync|unlink/);
    const card = readFileSync("src/utils/manual-backup/ManualBackupCard.tsx", "utf8");
    const importer = readFileSync("app/import.tsx", "utf8");
    assert.match(card, /r\.tone === "info" \? "info" : "error"/);
    assert.match(importer, /r\.tone === "info" \? "info" : "error"/);
    const store = readFileSync("src/security/key-manager-store.ts", "utf8");
    const verified = store.indexOf("if (result.verified && started === sessionGeneration)");
    const cacheWrite = store.indexOf("sessionCache = { raw: stored");
    assert.ok(verified > 0 && cacheWrite > verified);
  });
});
