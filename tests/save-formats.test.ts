import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  decryptBackup,
  detectEncryptedFormat,
  encryptV1,
  encryptV2,
  encryptV3,
} from "../src/security/backup-crypto.ts";
import { openBackupDocument } from "../src/utils/backup-file.ts";
import { protectedWrite, type SaveFs } from "../src/utils/protected-save.ts";

const SEED = "SSECRETSEEDFORTESTS";
const IV = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const SALT = Uint8Array.from({ length: 16 }, (_, i) => i + 16);

/** Frozen v1 ciphertext. iv bytes are 1..16. Do not regenerate casually. */
const FROZEN_V1 = "AQIDBAUGBwgJCgsMDQ4PEA==.ZMtP4Q2XbqLDAtQ241e6se8aCociM96+0CMdCKo9p88=";
const FROZEN_PLAIN = "{\"v\":1,\"hello\":\"world\"}";

function envelope(version: number, extra: Record<string, unknown> = {}) {
  return {
    v: version,
    writtenAt: 1_700_000_000_000,
    device: "phone",
    notes: [{ id: `note-${version}` }],
    bills: [{ id: `bill-${version}`, createdAt: 10 }],
    addresses: [
      {
        id: `addr-${version}`,
        label: `Friend ${version}`,
        publicKey: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
        createdAt: 10,
      },
    ],
    ...extra,
  };
}

function wrap(payload: string) {
  return JSON.stringify({
    format: "stellar-timelock-backup",
    v: 1,
    created_at: 1_700_000_000_000,
    payload,
  });
}

function memoryFs(files: Record<string, string> = {}): SaveFs & { files: Record<string, string> } {
  const store = { ...files };
  const pathOf = (p: string) => p;
  return {
    files: store,
    async exists(path) {
      return pathOf(path) in store;
    },
    async read(path) {
      return store[path];
    },
    async write(path, contents) {
      store[path] = contents;
    },
    async remove(path) {
      delete store[path];
    },
    async move(from, to) {
      store[to] = store[from];
      delete store[from];
    },
    async copy(from, to) {
      store[to] = store[from];
    },
    async list() {
      return Object.keys(store).map((path) => path.split("/").pop() ?? path);
    },
    async mkdir() {},
  };
}

describe("backup ciphertext formats", () => {
  it("decrypts the frozen two-part v1 file", () => {
    assert.equal(detectEncryptedFormat(FROZEN_V1), 1);
    assert.equal(decryptBackup(FROZEN_V1, SEED), FROZEN_PLAIN);
    assert.equal(decryptBackup(FROZEN_V1, "SOTHERSEED"), "");
  });

  it("round-trips v1, v2, and v3 without dropping the envelope", () => {
    const plain = JSON.stringify(envelope(8, { keyManager: [{ id: "k", secretSeed: "SABC", publicAddress: "GABC" }] }));
    const v1 = encryptV1(plain, SEED, IV);
    const v2 = encryptV2(plain, SEED, IV);
    const v3 = encryptV3(plain, SEED, IV, SALT);
    assert.equal(detectEncryptedFormat(v1), 1);
    assert.equal(detectEncryptedFormat(v2), 2);
    assert.equal(detectEncryptedFormat(v3), 3);
    assert.equal(v1.split(".").length, 2);
    assert.equal(v2.split(".").length, 3);
    assert.equal(decryptBackup(v1, SEED), plain);
    assert.equal(decryptBackup(v2, SEED), plain);
    assert.equal(decryptBackup(v3, SEED), plain);
    const tampered = v3.slice(0, -4) + "AAAA";
    assert.equal(decryptBackup(tampered, SEED), "");
  });
});

describe("backup file wrappers and envelope versions", () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`loads envelope v${version} from a two-part ciphertext`, () => {
      const body = envelope(version, {
        totp: [{ id: `totp-${version}`, name: "Mail", secret: "JBSWY3DPEHPK3PXP" }],
        keyManager: [{
          id: `km-${version}`,
          label: "Old key",
          secretSeed: "SDROWSSAP",
          publicAddress: "GABC",
          createdAt: 4,
        }],
        walletMeta: [{ id: "w", publicKey: "GABC", label: "House", createdAt: 4 }],
        money: { v: 1, writtenAt: 9, bills: [{ id: "b1", name: "Rent" }] },
      });
      const payload = encryptV1(JSON.stringify(body), SEED, IV);
      const opened = openBackupDocument(wrap(payload), SEED);
      assert.equal(opened.ok, true);
      if (!opened.ok) return;
      assert.equal(opened.backup.cryptoVersion, 1);
      assert.equal(opened.backup.envelope.v, version);
      assert.equal((opened.backup.envelope.addresses as { label: string }[])[0].label, `Friend ${version}`);
      assert.equal((opened.backup.envelope.keyManager as { secretSeed: string }[])[0].secretSeed, "SDROWSSAP");
      assert.equal((opened.backup.envelope.notes as { id: string }[])[0].id, `note-${version}`);
      assert.equal((opened.backup.envelope.walletMeta as { label: string }[])[0].label, "House");
      assert.equal(
        ((opened.backup.envelope.money as { bills: { name: string }[] }).bills)[0].name,
        "Rent",
      );
    });
  }

  it("opens the same payload from a .stvault wrapper and a .os wrapper", () => {
    const plain = JSON.stringify(envelope(7, { walletMeta: [{ id: "w", label: "Nick", publicKey: "GABC" }] }));
    const payload = encryptV2(plain, SEED, IV);
    const stvault = openBackupDocument(wrap(payload), SEED);
    const osFile = openBackupDocument(wrap(payload), SEED);
    assert.equal(stvault.ok && osFile.ok, true);
    if (!stvault.ok || !osFile.ok) return;
    assert.deepEqual(stvault.backup.envelope, osFile.backup.envelope);
  });

  it("opens a v3 file and refuses a bad mac", () => {
    const plain = JSON.stringify(envelope(8));
    const payload = encryptV3(plain, SEED, IV, SALT);
    const opened = openBackupDocument(wrap(payload), SEED);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.backup.cryptoVersion, 3);
    const bad = openBackupDocument(wrap(payload.slice(0, -3) + "xxx"), SEED);
    assert.equal(bad.ok, false);
  });

  it("keeps an omitted address list omitted so a restore can leave local contacts alone", () => {
    const body = { v: 3, writtenAt: 1, device: "phone", notes: [], bills: [] };
    const payload = encryptV1(JSON.stringify(body), SEED, IV);
    const opened = openBackupDocument(wrap(payload), SEED);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal("addresses" in opened.backup.envelope, false);
  });
});

describe("save overwrite protection", () => {
  it("copies the old file to bak1 before replacing it", async () => {
    const fs = memoryFs({ "/saves/key-manager.json": "{\"secretSeed\":\"SOLD\"}" });
    await protectedWrite({
      fs,
      directory: "/saves",
      fileName: "key-manager.json",
      next: "{\"secretSeed\":\"km1:newer-and-longer\"}",
    });
    assert.match(fs.files["/saves/key-manager.json.bak1"], /SOLD/);
    assert.match(fs.files["/saves/key-manager.json"], /km1:newer/);
  });

  it("refuses a shorter replace when the caller does not confirm", async () => {
    const fs = memoryFs({ "/saves/wallet.os": "a-long-old-save" });
    await assert.rejects(
      () => protectedWrite({
        fs,
        directory: "/saves",
        fileName: "wallet.os",
        next: "short",
      }),
      /shrink/i,
    );
    assert.equal(fs.files["/saves/wallet.os"], "a-long-old-save");
  });

  it("backs up the document save and the .os copy in source", () => {
    const source = readFileSync("src/utils/manual-backup/manual-backup.ts", "utf8");
    assert.match(source, /documentUri}\.bak/);
    assert.match(source, /left unchanged/);
    assert.match(source, /protectedWrite/);
    assert.match(source, /\$\{fileName\}\.bak/);
  });
});
