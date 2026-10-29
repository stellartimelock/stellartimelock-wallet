// Unit tests: old-format .stvault file detection and forward-compat parse.
//
// Real users have .stvault files created before the .os migration.  This
// suite proves that the format parser accepts them without modification and
// that the stem/path helpers produce the correct .os output path alongside
// the preserved original.

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
// Simulated old .stvault file fixtures
// ---------------------------------------------------------------------------

/** Minimal valid old-format .stvault JSON (as it appears on disk). */
const LEGACY_STVAULT_PAYLOAD = JSON.stringify({
  format: "stellar-timelock-backup",
  v: 1,
  created_at: 1700000000000,
  payload: "dGVzdGl2YmFzZTY0.dGVzdGNpcGhlcnRleHQ=.dGVzdGhtYWM=",
});

/** A .stvault written before the .os migration (pre-1.6.1). */
const LEGACY_FILE_NAME = "stellar-timelock-backup-2024-11-14T12-00-00.stvault";

// ---------------------------------------------------------------------------
// Shared format validator (mirrors the guard in restoreManualBackupPayload)
// ---------------------------------------------------------------------------

function parseBackupFile(raw: string): {
  ok: true;
  format: string;
  v: number;
  created_at: number;
  payload: string;
} | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  const file = parsed as Record<string, unknown> | null;
  if (!file) return { ok: false, error: "Null payload" };
  if (file["format"] !== "stellar-timelock-backup")
    return { ok: false, error: "Unknown format" };
  if (typeof file["payload"] !== "string")
    return { ok: false, error: "Missing payload string" };
  return {
    ok: true,
    format: file["format"] as string,
    v: (file["v"] as number) ?? 1,
    created_at: (file["created_at"] as number) ?? 0,
    payload: file["payload"] as string,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("legacy .stvault file — load and migrate", () => {
  it("parses a legacy .stvault file without error", () => {
    const result = parseBackupFile(LEGACY_STVAULT_PAYLOAD);
    assert.equal(result.ok, true);
  });

  it("reads the format field correctly from a legacy file", () => {
    const result = parseBackupFile(LEGACY_STVAULT_PAYLOAD);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.format, "stellar-timelock-backup");
  });

  it("reads the payload field correctly from a legacy file", () => {
    const result = parseBackupFile(LEGACY_STVAULT_PAYLOAD);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(
      result.payload,
      "dGVzdGl2YmFzZTY0.dGVzdGNpcGhlcnRleHQ=.dGVzdGhtYWM=",
    );
  });

  it("reads the version field from a legacy file", () => {
    const result = parseBackupFile(LEGACY_STVAULT_PAYLOAD);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.v, 1);
  });

  it("reads the created_at timestamp from a legacy file", () => {
    const result = parseBackupFile(LEGACY_STVAULT_PAYLOAD);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.created_at, 1700000000000);
  });

  it("rejects a file missing the format field", () => {
    const bad = JSON.stringify({ payload: "x" });
    const result = parseBackupFile(bad);
    assert.equal(result.ok, false);
  });

  it("rejects a file with the wrong format value", () => {
    const bad = JSON.stringify({ format: "other-app-backup", payload: "x" });
    const result = parseBackupFile(bad);
    assert.equal(result.ok, false);
  });

  it("rejects a file missing the payload field", () => {
    const bad = JSON.stringify({ format: "stellar-timelock-backup" });
    const result = parseBackupFile(bad);
    assert.equal(result.ok, false);
  });

  it("rejects a file with a non-string payload", () => {
    const bad = JSON.stringify({
      format: "stellar-timelock-backup",
      payload: 123,
    });
    const result = parseBackupFile(bad);
    assert.equal(result.ok, false);
  });

  it("accepts a .os file with identical JSON format (no extension check in parser)", () => {
    // The restore function checks format + payload only — the extension is irrelevant.
    // A file previously saved as .stvault and re-exported as .os must work.
    const osContent = JSON.stringify({
      format: "stellar-timelock-backup",
      v: 1,
      created_at: 1728000000000,
      payload: "aXZiYXNlNjQ=.Y2lwaGVydGV4dA==.aG1hYw==",
    });
    const result = parseBackupFile(osContent);
    assert.equal(result.ok, true);
  });
});

describe("legacy .stvault → .os migration path helpers", () => {
  it("strips the .stvault extension to derive the stem for the .os output", () => {
    const stem = stemFromFileName(LEGACY_FILE_NAME);
    assert.equal(stem, "stellar-timelock-backup-2024-11-14T12-00-00");
  });

  it("constructs the .os output path under OS/StellarTimeLock/", () => {
    const stem = stemFromFileName(LEGACY_FILE_NAME);
    const base = "/data/user/0/com.stellartimelock/files";
    const path = osSavePath(base, stem);
    assert.equal(
      path,
      `${base}/OS/${OS_SAVE_APP_NAME}/stellar-timelock-backup-2024-11-14T12-00-00.${OS_SAVE_EXT}`,
    );
  });

  it("does not double-add the .stvault extension to the stem", () => {
    const stem = stemFromFileName(LEGACY_FILE_NAME);
    assert.ok(!stem.includes(MANUAL_BACKUP_EXT));
  });

  it("uses the correct .os extension", () => {
    assert.equal(OS_SAVE_EXT, "os");
  });

  it("uses StellarTimeLock as the OS folder name", () => {
    assert.equal(OS_SAVE_APP_NAME, "StellarTimeLock");
  });

  it("preserves the stem through a round-trip: file → stem → path", () => {
    const raw = "my-old-backup.stvault";
    const stem = stemFromFileName(raw);
    const path = osSavePath("/files/", stem);
    assert.ok(path.endsWith("/OS/StellarTimeLock/my-old-backup.os"));
  });

  it("leaves filenames without the .stvault extension unchanged (e.g. a .json export)", () => {
    const stem = stemFromFileName("backup.json");
    assert.equal(stem, "backup.json");
    const path = osSavePath("/files/", stem);
    // Extension is appended by osSavePath; original .json stays in the stem.
    assert.ok(path.endsWith("/OS/StellarTimeLock/backup.json.os"));
  });
});
