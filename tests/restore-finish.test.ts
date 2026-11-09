import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BACKUP_FOLDER_NAME,
  BACKUP_FOLDER_PROMPT,
  backupAppDirectory,
  backupFilePath,
  shouldPromptForBackupFolder,
} from "../src/utils/manual-backup/backup-location.ts";
import { openClassifiedBackup } from "../src/utils/manual-backup/classify-picked-file.ts";
import { readTextOrExplain, unreadableFileMessage } from "../src/utils/manual-backup/read-backup-text.ts";
import {
  coercedEnvelopeVersion,
  keysFromRestoredWallets,
  mergeRestoredAddresses,
  mergeRestoredKeys,
  mergeRestoredTotp,
} from "../src/utils/manual-backup/restore-merge.ts";

const G = "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";

describe("backup restore finishes", () => {
  it("auto-saves under StellarTimeLock backups/<app>/", () => {
    assert.equal(BACKUP_FOLDER_NAME, "StellarTimeLock backups");
    const dir = backupAppDirectory("/data/user/0/com.stellartimelock/files/", "StellarTimeLock");
    assert.equal(dir, "/data/user/0/com.stellartimelock/files/StellarTimeLock backups/StellarTimeLock");
    assert.equal(
      backupFilePath("/files", "StellarTimeLock", "wallet.stvault"),
      "/files/StellarTimeLock backups/StellarTimeLock/wallet.stvault",
    );
  });

  it("asks once when the old backup path is missing", () => {
    assert.equal(
      shouldPromptForBackupFolder({
        newFolderExists: false,
        oldPathExists: false,
        alreadyPrompted: false,
      }),
      true,
    );
    assert.equal(
      shouldPromptForBackupFolder({
        newFolderExists: false,
        oldPathExists: true,
        alreadyPrompted: false,
      }),
      false,
    );
    assert.equal(
      shouldPromptForBackupFolder({
        newFolderExists: true,
        oldPathExists: false,
        alreadyPrompted: false,
      }),
      false,
    );
    assert.equal(
      shouldPromptForBackupFolder({
        newFolderExists: false,
        oldPathExists: false,
        alreadyPrompted: true,
      }),
      false,
    );
    assert.match(BACKUP_FOLDER_PROMPT, /StellarTimeLock backups/);
  });

  it("returns a plain error when a file read never resolves", async () => {
    const hung = readTextOrExplain("old-wallet.stvault", () => new Promise(() => {}), 30);
    const missing = readTextOrExplain("gone.stvault", async () => {
      throw new Error("ENOENT");
    }, 30);
    const opened = await hung;
    const failed = await missing;
    assert.equal(opened.ok, false);
    assert.equal(failed.ok, false);
    if (!opened.ok) assert.equal(opened.error, unreadableFileMessage("old-wallet.stvault"));
    if (!failed.ok) {
      assert.match(failed.error, /gone\.stvault/);
      assert.match(failed.error, /missing or can.t be opened/);
    }
    assert.doesNotMatch(unreadableFileMessage("x"), /seed|secret/i);
  });

  it("opens an older envelope that has no wrapper and no version", async () => {
    const raw = JSON.stringify({
      device: "phone",
      notes: [],
      bills: [],
      addresses: [
        {
          id: "c1",
          label: "Ada",
          publicKey: G,
          defaultMemo: "",
          kind: "private",
          createdAt: 10,
        },
      ],
    });
    const opened = await openClassifiedBackup("legacy.json", raw, "SOTHER", async () => "");
    assert.equal(opened.ok, true);
    if (opened.ok) {
      const env = JSON.parse(opened.plaintext) as { v?: unknown; addresses: unknown[] };
      assert.equal(coercedEnvelopeVersion(env.v, true), 1);
      assert.equal(env.addresses.length, 1);
    }
    assert.equal(coercedEnvelopeVersion("3", true), 3);
    assert.equal(coercedEnvelopeVersion(8, true), 8);
    assert.equal(coercedEnvelopeVersion("nope", false), null);
  });

  it("writes each section once, including every contact in a large list", () => {
    const remote = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      label: `Friend ${i}`,
      publicKey: G,
      defaultMemo: "",
      kind: "private",
      createdAt: i + 1,
    }));
    const merged = mergeRestoredAddresses(
      [{ id: "keep-out", label: "Old", publicKey: G, defaultMemo: "", kind: "private", createdAt: 1 }],
      remote,
    );
    assert.ok(merged);
    assert.equal(merged?.length, 40);
    assert.equal(merged?.some((row) => row.id === "keep-out"), false);

    const totp = mergeRestoredTotp([], [
      { id: "t1", name: "Mail", secret: "abcd", isDefault: false, createdAt: 1, updatedAt: 1 },
    ]);
    assert.equal(totp?.length, 1);

    const keys = mergeRestoredKeys([], [
      {
        id: "k1",
        label: "Cold",
        secretSeed: "SAEWIVK3VLNEJ3WEJRZXQGDAS5NVG2BYSYDFRSH4GKVTS5RXNVED5AX7",
        publicAddress: "GC3MMSXBWHL6CPOAVERSJITX7BH76YU252WGLUOM5CJX3E7UCYZBTPJQ",
        createdAt: 1,
      },
    ]);
    assert.equal(keys?.length, 1);
  });

  it("puts every backup wallet into Key Manager, even when it was not a saved key", () => {
    const savedPub = "GC3MMSXBWHL6CPOAVERSJITX7BH76YU252WGLUOM5CJX3E7UCYZBTPJQ";
    const savedSeed = "SAEWIVK3VLNEJ3WEJRZXQGDAS5NVG2BYSYDFRSH4GKVTS5RXNVED5AX7";
    const existing = mergeRestoredKeys([], [
      {
        id: "k1",
        label: "Old name",
        secretSeed: savedSeed,
        publicAddress: savedPub,
        createdAt: 1,
      },
    ]);
    assert.ok(existing);
    const wallets = [
      { id: "w_travel", label: "Travel", publicKey: G, createdAt: 2 },
      { id: "w_cold", label: "Cold storage", publicKey: savedPub, createdAt: 3, updatedAt: 10 },
    ];
    const merged = keysFromRestoredWallets(existing ?? [], wallets);
    assert.equal(merged.length, 2);
    const travel = merged.find((row) => row.publicAddress === G);
    assert.equal(travel?.watchOnly, true);
    assert.equal(travel?.secretSeed, "");
    assert.equal(travel?.label, "Travel");
    assert.equal(travel?.id, "km_wallet_w_travel");
    const cold = merged.find((row) => row.publicAddress === savedPub);
    assert.equal(cold?.id, "k1");
    assert.equal(cold?.label, "Cold storage");
    assert.equal(cold?.secretSeed, savedSeed);
    assert.notEqual(cold?.watchOnly, true);

    const signed = keysFromRestoredWallets([], [
      { id: "w_cold", label: "Cold storage", publicKey: savedPub, createdAt: 1 },
    ], { [savedPub]: savedSeed });
    assert.equal(signed.length, 1);
    assert.equal(signed[0]?.watchOnly, undefined);
    assert.equal(signed[0]?.secretSeed, savedSeed);
    assert.equal(signed[0]?.publicAddress, savedPub);
  });

  it("keeps restore from deleting files and shows progress in the source", () => {
    const source = readFileSync("src/utils/manual-backup/manual-backup.ts", "utf8");
    const card = readFileSync("src/utils/manual-backup/ManualBackupCard.tsx", "utf8");
    assert.match(source, /StellarTimeLock backups/);
    assert.match(source, /backupFolderPromptNeeded/);
    assert.match(source, /readTextOrExplain/);
    assert.match(card, /manual-backup-progress/);
    assert.match(card, /manual-backup-folder-prompt/);
    const envelope = readFileSync("src/utils/backup-envelope.ts", "utf8");
    assert.match(envelope, /keysFromRestoredWallets/);
    assert.doesNotMatch(
      source.slice(source.indexOf("export async function restoreManualBackupPayload")),
      /deleteAsync|unlink/,
    );
  });
});
