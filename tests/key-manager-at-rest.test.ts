import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { encryptV1, encryptV2 } from "../src/security/backup-crypto.ts";
import {
  isPlaintextKeyManagerPayload,
  openKeyManagerPayload,
  runKeyManagerMigration,
  type MigrationIo,
} from "../src/security/key-manager-at-rest.ts";

const SEED = "SSECRETSEEDFORTESTSXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const OTHER = "SOTHERSEEDFORTESTSXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const IV = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

const V1_ROW = {
  id: "km_old",
  label: "House",
  secretSeed: "SDROWSSAPEXAMPLE",
  publicAddress: "GABC",
  createdAt: 10,
};

const V2_ROW = {
  id: "km_eth",
  label: "Ether",
  chain: "eth",
  watchOnly: false,
  secretSeed: "0xabc123",
  publicAddress: "0xdef",
  seedPhrase: "legal winner thank year wave sausage worth useful legal winner thank yellow",
  notes: "cold wallet",
  createdAt: 11,
};

function memoryIo(initial: string): MigrationIo & {
  live: string;
  backup: string | null;
  order: string[];
} {
  const state = {
    live: initial,
    backup: null as string | null,
    order: [] as string[],
  };
  let n = 0;
  return {
    ...state,
    get live() { return state.live; },
    get backup() { return state.backup; },
    order: state.order,
    async readLive() {
      return state.live;
    },
    async writeLive(json: string) {
      state.order.push("write");
      state.live = json;
    },
    async backupPlaintext(json: string) {
      state.order.push("backup");
      if (state.backup == null) state.backup = json;
    },
    async removeBackup() {
      state.order.push("remove");
      state.backup = null;
    },
    random: async () => {
      n += 1;
      return Uint8Array.from({ length: 16 }, (_, i) => (n * 17 + i) & 0xff);
    },
  };
}

describe("Key Manager seed encryption", () => {
  it("encrypts a plaintext v1 row and a v2 row without dropping fields", async () => {
    const io = memoryIo(JSON.stringify([V1_ROW, V2_ROW]));
    const result = await runKeyManagerMigration(io, SEED, io.random);
    assert.equal(result.verified, true);
    assert.equal(result.migrated, true);
    assert.equal(result.entries[0].secretSeed, V1_ROW.secretSeed);
    assert.equal(result.entries[0].publicAddress, "GABC");
    assert.equal(result.entries[1].chain, "eth");
    assert.equal(result.entries[1].seedPhrase, V2_ROW.seedPhrase);
    assert.equal(result.entries[1].notes, "cold wallet");
    assert.equal(isPlaintextKeyManagerPayload(io.live), false);
    assert.match(io.live, /^v3\./);
    assert.equal(io.backup, null);
    assert.deepEqual(io.order, ["backup", "write", "remove"]);
  });

  it("opens the encrypted save on a new phone with the same seed", async () => {
    const first = memoryIo(JSON.stringify([V1_ROW, V2_ROW]));
    await runKeyManagerMigration(first, SEED, first.random);
    const phone = memoryIo(first.live);
    const opened = openKeyManagerPayload(phone.live, SEED);
    assert.ok(opened);
    assert.equal(opened?.[0].secretSeed, V1_ROW.secretSeed);
    assert.equal(opened?.[1].seedPhrase, V2_ROW.seedPhrase);
    const again = await runKeyManagerMigration(phone, SEED, phone.random);
    assert.equal(again.migrated, false);
    assert.equal(again.verified, true);
    assert.equal(again.entries[1].publicAddress, "0xdef");
    assert.equal(phone.order.length, 0);
  });

  it("does not replace the live file when the seed is missing or the backup cannot be written", async () => {
    const plain = JSON.stringify([V1_ROW]);
    const locked = memoryIo(plain);
    const held = await runKeyManagerMigration(locked, null, locked.random);
    assert.equal(held.entries[0].secretSeed, V1_ROW.secretSeed);
    assert.equal(locked.live, plain);
    assert.deepEqual(locked.order, []);

    const io = memoryIo(plain);
    io.backupPlaintext = async () => {
      io.order.push("backup");
      throw new Error("disk full");
    };
    const result = await runKeyManagerMigration(io, SEED, io.random);
    assert.equal(result.verified, false);
    assert.equal(io.live, plain);
    assert.equal(io.backup, null);
  });

  it("reads an older v1 ciphertext and an older v2 ciphertext", async () => {
    const plain = JSON.stringify([V1_ROW, V2_ROW]);
    for (const payload of [encryptV1(plain, SEED, IV), encryptV2(plain, SEED, IV)]) {
      const opened = openKeyManagerPayload(payload, SEED);
      assert.equal(opened?.[0].secretSeed, V1_ROW.secretSeed);
      assert.equal(opened?.[1].notes, "cold wallet");
      assert.equal(openKeyManagerPayload(payload, OTHER), null);
    }
  });

  it("writes the plaintext back when the saved ciphertext does not open", async () => {
    const original = JSON.stringify([V1_ROW]);
    const io = memoryIo(original);
    const realWrite = io.writeLive.bind(io);
    let writes = 0;
    io.writeLive = async (json: string) => {
      writes += 1;
      if (writes === 1) {
        await realWrite("v3.not-a-real-payload.aaaa.bbbb.cccc");
        return;
      }
      await realWrite(json);
    };
    const result = await runKeyManagerMigration(io, SEED, io.random);
    assert.equal(result.verified, false);
    assert.equal(io.live, original);
    assert.equal(io.backup, original);
  });

  it("PICK_KEY decrypts only after biometric, from the in-RAM seed", () => {
    const activity = readFileSync(
      "android/app/src/main/java/com/stellartimelock/keys/KeyPickerActivity.kt",
      "utf8",
    );
    const reader = readFileSync(
      "android/app/src/main/java/com/stellartimelock/keys/KeyManagerReader.kt",
      "utf8",
    );
    const crypto = readFileSync(
      "android/app/src/main/java/com/stellartimelock/keys/PortableBackupCrypto.kt",
      "utf8",
    );
    const managed = readFileSync(
      "android/app/src/main/java/com/stellartimelock/keys/ManagedKey.kt",
      "utf8",
    );
    const app = readFileSync(
      "android/app/src/main/java/com/stellartimelock/MainApplication.kt",
      "utf8",
    );
    assert.match(activity, /WalletSeedMemory\.copySeed\(\)/);
    assert.match(activity, /KeyManagerReader\.load\(applicationContext, seed\)/);
    assert.doesNotMatch(activity, /KeyManagerReader\.load\(applicationContext\)/);
    assert.match(activity, /BIOMETRIC_STRONG/);
    assert.match(reader, /PortableBackupCrypto\.looksEncrypted/);
    assert.match(crypto, /v3/);
    assert.match(crypto, /100_000/);
    assert.match(crypto, /xlm_vault_notebook_v2_salt/);
    assert.doesNotMatch(crypto, /AndroidKeyStore/);
    assert.doesNotMatch(managed, /AndroidKeyStore/);
    assert.doesNotMatch(crypto, /Log\./);
    assert.match(app, /WalletSeedMemoryPackage/);
    assert.doesNotMatch(app, /KeyManagerAtRestPackage/);
  });
});
