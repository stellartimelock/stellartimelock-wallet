// Tests for the .os save path migration (item 4 of the Settings pass).
//
// Covers:
//   1. osSavePath() — pure path construction under OS/StellarTimeLock/
//   2. Legacy .stvault restore format acceptance (format validation is pure)
//   3. Backward compat: legacy format JSON parses correctly

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  osSavePath,
  stemFromFileName,
  OS_SAVE_APP_NAME,
  OS_SAVE_EXT,
  MANUAL_BACKUP_EXT,
} from "../src/utils/manual-backup/os-save-path.ts";

// ---------------------------------------------------------------------------
// 1. Path construction
// ---------------------------------------------------------------------------

describe("osSavePath", () => {
  it("constructs the correct OS/StellarTimeLock/ path with trailing slash on base dir", () => {
    const path = osSavePath("/data/user/0/com.stellartimelock/files/", "backup-2026-10-06");
    assert.equal(
      path,
      `/data/user/0/com.stellartimelock/files/OS/${OS_SAVE_APP_NAME}/backup-2026-10-06.${OS_SAVE_EXT}`,
    );
  });

  it("constructs the correct path without trailing slash on base dir", () => {
    const path = osSavePath("/data/user/0/com.stellartimelock/files", "my-backup");
    assert.equal(
      path,
      `/data/user/0/com.stellartimelock/files/OS/${OS_SAVE_APP_NAME}/my-backup.${OS_SAVE_EXT}`,
    );
  });

  it("uses the correct app name and extension constants", () => {
    assert.equal(OS_SAVE_APP_NAME, "StellarTimeLock");
    assert.equal(OS_SAVE_EXT, "os");
    assert.equal(MANUAL_BACKUP_EXT, "stvault");
  });

  it("includes stem without double-extension", () => {
    const stem = "stellar-timelock-backup-2026-10-06T12-00-00";
    const path = osSavePath("/files/", stem);
    assert.ok(path.endsWith(`.${OS_SAVE_EXT}`));
    assert.ok(!path.endsWith(`.${MANUAL_BACKUP_EXT}.${OS_SAVE_EXT}`));
  });
});

// ---------------------------------------------------------------------------
// 2. Legacy restore format — pure format validation
// ---------------------------------------------------------------------------

describe("legacy .stvault restore format", () => {
  /**
   * Replicate the format guard from restoreManualBackupPayload so we can
   * test it without requiring the crypto stack.
   */
  function isValidBackupShape(raw: unknown): boolean {
    const file = raw as Record<string, unknown> | null;
    if (!file) return false;
    if (file["format"] !== "stellar-timelock-backup") return false;
    if (typeof file["payload"] !== "string") return false;
    return true;
  }

  it("accepts the canonical v1 .stvault format", () => {
    const legacy = {
      format: "stellar-timelock-backup",
      v: 1,
      created_at: 1728000000000,
      payload: "iv.ciphertext.hmac",
    };
    assert.equal(isValidBackupShape(legacy), true);
  });

  it("accepts a .os file with the same payload format (no extension check in parser)", () => {
    // The restore function checks format + payload fields only — not file extension.
    // A .os file with identical JSON structure must be accepted.
    const osFormat = {
      format: "stellar-timelock-backup",
      v: 1,
      created_at: 1728000000000,
      payload: "somebase64ciphertext",
    };
    assert.equal(isValidBackupShape(osFormat), true);
  });

  it("rejects an unknown format field", () => {
    assert.equal(isValidBackupShape({ format: "unknown", payload: "x" }), false);
    assert.equal(isValidBackupShape({ format: "stellar-timelock-backup" }), false);
    assert.equal(isValidBackupShape(null), false);
    assert.equal(isValidBackupShape({}), false);
  });

  it("rejects a non-string payload", () => {
    assert.equal(
      isValidBackupShape({ format: "stellar-timelock-backup", payload: 42 }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Stem derivation logic — the stem used for .os files comes from the
//    .stvault filename by stripping the old extension.
// ---------------------------------------------------------------------------

describe("stem derivation for .os output", () => {
  it("strips the .stvault extension to get the stem", () => {
    assert.equal(
      stemFromFileName("stellar-timelock-backup-2026-10-06T12-00-00.stvault"),
      "stellar-timelock-backup-2026-10-06T12-00-00",
    );
  });

  it("leaves filenames without the extension unchanged", () => {
    assert.equal(stemFromFileName("my-backup.json"), "my-backup.json");
  });

  it("round-trips stem through osSavePath correctly", () => {
    const fileName = "stellar-timelock-backup-2026-10-06T12-00-00.stvault";
    const stem = stemFromFileName(fileName);
    const path = osSavePath("/files/", stem);
    assert.equal(path, `/files/OS/StellarTimeLock/stellar-timelock-backup-2026-10-06T12-00-00.os`);
  });
});
