import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { describe, it } from "node:test";

import CryptoJS from "crypto-js";

import {
  decryptBackup,
  decryptBackupAsync,
  encryptV2,
  encryptV2CryptoJsDefault,
} from "../src/security/backup-crypto.ts";
import {
  decryptFailedMessage,
  openClassifiedBackup,
} from "../src/utils/manual-backup/classify-picked-file.ts";

const writers = JSON.parse(
  readFileSync("tests/fixtures/backup-writers-1.0-1.6.7.json", "utf8"),
) as {
  plain: string;
  seed: string;
  writers: Record<string, { cipher: string; payload: string }>;
};

const SEED = writers.seed;
const PLAIN = writers.plain;
const IV = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const LEGACY = writers.writers["export-1.0.0-through-1.6.3"].payload;

function wrap(payload: string): string {
  return JSON.stringify({
    format: "stellar-timelock-backup",
    v: 1,
    payload,
  });
}

function toUrl(payload: string): string {
  return payload.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("1.6.8 restore opens every backup writer", () => {
  it("matches the 1.0.0–1.6.3 writer, which is SHA-256 even though no hasher was passed", () => {
    assert.equal(encryptV2CryptoJsDefault(PLAIN, SEED, IV), LEGACY);
    assert.notEqual(encryptV2(PLAIN, SEED, IV), LEGACY);
    assert.equal(decryptBackup(LEGACY, SEED), PLAIN);
    assert.equal(decryptBackup(LEGACY, "SOTHERSEED"), "");
  });

  it("opens each frozen writer from a .stvault and a .os name", async () => {
    for (const [id, writer] of Object.entries(writers.writers)) {
      for (const name of [`${id}.stvault`, `${id}.os`]) {
        const opened = await openClassifiedBackup(name, wrap(writer.payload), SEED, decryptBackup);
        assert.equal(opened.ok, true, id);
        if (opened.ok) assert.equal(opened.plaintext, PLAIN);
      }
    }
  });

  it("opens a 1.0–1.6.3 file with line breaks, base64url, a BOM, or a JSON string around it", async () => {
    const broken = LEGACY.replace(/\./g, ".\n");
    const url = toUrl(LEGACY);
    assert.equal(decryptBackup(broken, SEED), PLAIN);
    assert.equal(decryptBackup(url, SEED), PLAIN);
    const bom = await openClassifiedBackup(
      "stellar-timelock-backup-old.stvault",
      `\uFEFF${JSON.stringify(wrap(broken))}`,
      SEED,
      decryptBackup,
    );
    assert.equal(bom.ok, true);
    const quoted = await openClassifiedBackup(
      "copied.os",
      JSON.stringify(wrap(url)),
      SEED,
      decryptBackup,
    );
    assert.equal(quoted.ok, true);
  });

  it("tries the seed's other spellings before it gives up", () => {
    const canonical = encryptV2CryptoJsDefault(PLAIN, SEED, IV);
    assert.equal(decryptBackup(canonical, `  ${SEED.toLowerCase()} \n`), PLAIN);
    const lower = encryptV2CryptoJsDefault(PLAIN, SEED.toLowerCase(), IV);
    assert.equal(decryptBackup(lower, SEED), PLAIN);
  });

  it("names the file, the detected cipher, and a seed mismatch", async () => {
    const opened = await openClassifiedBackup(
      "stellar-timelock-backup-2024.stvault",
      wrap(LEGACY),
      "SOTHERSEED",
      decryptBackup,
    );
    assert.equal(opened.ok, false);
    if (opened.ok) return;
    assert.equal(opened.tone, "error");
    assert.equal(opened.error, decryptFailedMessage("stellar-timelock-backup-2024.stvault", 2));
    assert.match(opened.error, /stellar-timelock-backup-2024\.stvault/);
    assert.match(opened.error, /cipher v2 \(iv\.ct\.mac\)/);
    assert.match(opened.error, /This seed does not open it/);
    assert.doesNotMatch(opened.error, /different wallet seed/);
  });

  it("calls an unknown layout inside a wallet wrapper an unknown format, not a bad seed", async () => {
    const salted = CryptoJS.AES.encrypt(PLAIN, SEED).toString();
    assert.match(salted, /^U2FsdGVkX1/);
    const opened = await openClassifiedBackup("notes.stvault", wrap(salted), SEED, decryptBackup);
    assert.equal(opened.ok, false);
    if (opened.ok) return;
    assert.equal(opened.tone, "info");
    assert.match(opened.error, /notes\.stvault/);
    assert.match(opened.error, /unknown/);
    assert.match(opened.error, /not a seed mismatch/);
    assert.doesNotMatch(opened.error, /Decryption failed/);
  });

  it("still refuses a Key Manager file without calling it a bad seed", async () => {
    const raw = writers.writers["export-1.6.4-through-1.6.7"].payload;
    const opened = await openClassifiedBackup("key-manager.json", raw, SEED, decryptBackup);
    assert.equal(opened.ok, false);
    if (opened.ok) return;
    assert.equal(opened.tone, "info");
    assert.match(opened.error, /Key Manager/);
    assert.doesNotMatch(opened.error, /Decryption failed/);
  });

  it("uses the wallet seed on the restore screen and does not pick a file by itself", () => {
    const card = readFileSync("src/utils/manual-backup/ManualBackupCard.tsx", "utf8");
    const restore = card.slice(card.indexOf("const handleImportFile"));
    assert.match(restore, /restoreManualBackupPayload\(\s*wallet\.secretSeed/);
    assert.doesNotMatch(restore, /unlockedWalletSeed|getWalletSeed|key-manager|PIN|wrapping key/);
    const picker = readFileSync("src/utils/manual-backup/manual-backup.ts", "utf8");
    const fn = picker.slice(
      picker.indexOf("export async function pickManualBackupFile"),
      picker.indexOf("export async function restoreManualBackupPayload"),
    );
    assert.match(fn, /DocumentPicker\.getDocumentAsync/);
    assert.doesNotMatch(fn, /modificationTime|readdir|newest|key-manager\.json/);
    assert.match(picker, /export async function exportManualBackup\(\s*secretSeed: string/);
    assert.doesNotMatch(
      picker.slice(picker.indexOf("export async function exportManualBackup")),
      /password:/,
    );
  });

  it("opens the 1.0–1.6.3 file through the yielding reader as well", async () => {
    assert.equal(await decryptBackupAsync(LEGACY, SEED), PLAIN);
    assert.equal(
      await decryptBackupAsync(writers.writers["export-1.6.4-through-1.6.7"].payload, SEED),
      PLAIN,
    );
  });
});
