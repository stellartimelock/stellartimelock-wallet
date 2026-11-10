import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function readSrc(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("1.6.23 export encrypt yields and times out", () => {
  it("public encrypt() uses the yielding v3 seal, not the sync 100k-round KDF", () => {
    const body = readSrc("../src/security/crypto.ts");
    assert.match(body, /encryptV3Async/);
    assert.match(body, /return encryptV3Async\(/);
    assert.equal(body.includes("return encryptV3("), false);
  });

  it("export wraps encrypt and the SAF folder write in a timeout with a clear error", () => {
    const body = readSrc("../src/utils/manual-backup/manual-backup.ts");
    assert.match(body, /EXPORT_ENCRYPT_TIMEOUT_MS/);
    assert.match(body, /EXPORT_SAF_WRITE_TIMEOUT_MS/);
    assert.match(body, /withExportTimeout/);
    assert.match(body, /onProgress/);
    assert.match(body, /Encrypting backup/);
    assert.match(body, /Writing to selected folder/);
    assert.match(body, /EXPORT_ENCRYPT_TIMEOUT_MESSAGE/);
    assert.match(body, /EXPORT_FOLDER_WRITE_TIMEOUT_MESSAGE/);
    assert.match(body, /Documents\/STLBackup/);
    assert.match(body, /Backup encryption took too long/);
  });

  it("export UI shows progress while encrypting", () => {
    const body = readSrc("../src/utils/manual-backup/ManualBackupCard.tsx");
    assert.match(body, /exportProgress/);
    assert.match(body, /manual-backup-export-progress/);
    assert.match(body, /onProgress:\s*setExportProgress/);
  });
});
