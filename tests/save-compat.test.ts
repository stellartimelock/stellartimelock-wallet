import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { planSaveReplace, readSaveDocument } from "../src/utils/save-compat.ts";

const dir = path.join("tests", "fixtures", "saves");

function load(name: string): unknown {
  return JSON.parse(readFileSync(path.join(dir, name), "utf8"));
}

describe("older saves still open", () => {
  it("loads every fixture without throwing", () => {
    const names = readdirSync(dir).filter((name) => name.endsWith(".json"));
    assert.ok(names.length >= 11);
    for (const name of names) {
      const read = readSaveDocument(load(name));
      assert.equal(Array.isArray(read.warnings), true, name);
      assert.notEqual(read.kind, "unknown", name);
    }
  });

  it("keeps a v1 address that has no network or updatedAt", () => {
    const read = readSaveDocument(load("envelope-v1-addresses.json"));
    assert.equal(read.envelopeVersion, 1);
    assert.equal(read.addresses.length, 1);
    assert.equal(read.addresses[0].label, "Northwind Studio");
    assert.equal(read.addresses[0].network, "stellar");
    assert.equal(read.addresses[0].updatedAt, 1700000000000);
    assert.equal(read.moneyIgnored, false);
  });

  it("keeps a v6 contact and totp and ignores a bills stub", () => {
    const read = readSaveDocument(load("envelope-v6-totp.json"));
    assert.equal(read.envelopeVersion, 6);
    assert.equal(read.addresses[0].label, "Alex Rivera");
    assert.equal(read.addresses[0].defaultMemo, "rent");
    assert.equal(read.totp[0].secret, "JBSWY3DPEHPK3PXP");
    assert.equal(read.moneyIgnored, true);
    assert.equal(read.billsStubCount, 1);
  });

  it("keeps v7 wallet nicknames", () => {
    const read = readSaveDocument(load("envelope-v7-wallet-meta.json"));
    assert.equal(read.wallets[0].label, "Harbor sample");
    assert.equal(read.wallets[0].publicKey.startsWith("GB6P6K3CFD"), true);
    assert.equal(read.addresses[0].kind, "exchange");
  });

  it("keeps a pre-1.6.2 key that has no chain field", () => {
    const read = readSaveDocument(load("envelope-v8-keys-stellar.json"));
    assert.equal(read.keys[0].chain, "stellar");
    assert.equal(read.keys[0].watchOnly, false);
    assert.equal(read.keys[0].secretSeed.startsWith("S"), true);
    assert.equal(read.wallets[0].kind, "legacy");
  });

  it("keeps a 1.6.2 multi-chain watch-only key", () => {
    const read = readSaveDocument(load("envelope-v8-keys-multichain.json"));
    assert.equal(read.keys[0].chain, "sol");
    assert.equal(read.keys[0].watchOnly, true);
    assert.equal(read.keys[0].publicAddress.startsWith("7xKX"), true);
  });

  it("ignores a money document and still returns the address book", () => {
    const read = readSaveDocument(load("envelope-v8-with-money.json"));
    assert.equal(read.moneyIgnored, true);
    assert.equal(read.addresses[0].label, "Alex Rivera");
    assert.equal(JSON.stringify(read).includes("Power"), false);
    assert.equal(JSON.stringify(read).includes("futureFeature"), false);
  });

  it("unwraps a plaintext .stvault and leaves a sealed one sealed", () => {
    const open = readSaveDocument(load("stvault-wrapper-v1.json"));
    assert.equal(open.kind, "backup-file");
    assert.equal(open.sealed, false);
    assert.equal(open.addresses[0].label, "Northwind Studio");
    const sealed = readSaveDocument(load("stvault-wrapper-sealed-v1.json"));
    assert.equal(sealed.kind, "backup-file");
    assert.equal(sealed.sealed, true);
    assert.equal(sealed.addresses.length, 0);
  });

  it("reads the .os file with the same parser as .stvault", () => {
    const same = readSaveDocument(readFileSync(path.join(dir, "stvault-wrapper-v1.json"), "utf8"));
    assert.equal(same.addresses[0].id, "c_northwind");
  });

  it("reads an old address-book blob, wallet book, key list, and tap-pay file", () => {
    const book = readSaveDocument(load("address-book-v1.json"));
    assert.equal(book.kind, "address-book");
    assert.equal(book.addresses[0].network, "stellar");
    const wallets = readSaveDocument(load("wallet-book-v1.json"));
    assert.equal(wallets.kind, "wallet-book");
    assert.equal(wallets.wallets[0].label, "Harbor sample");
    const keys = readSaveDocument(load("key-manager-v1.json"));
    assert.equal(keys.kind, "key-manager");
    assert.equal(keys.keys[0].chain, "stellar");
    const tap = readSaveDocument(load("tap-pay-v1.json"));
    assert.equal(tap.kind, "tap-pay");
    assert.equal(tap.tapPay?.paymentCount, 1);
    assert.equal(tap.tapPay?.knownRecipients[0].startsWith("GB6P"), true);
  });

  it("does not throw on garbage money", () => {
    const read = readSaveDocument({
      v: 8,
      device: "stellar-timelock-wallet",
      notes: [],
      bills: "nope",
      addresses: [
        {
          id: "c1",
          label: "Kept",
          publicKey: "GABC",
          defaultMemo: "",
          kind: "private",
          createdAt: 1,
        },
      ],
      money: "not-an-object",
    });
    assert.equal(read.addresses[0].label, "Kept");
    assert.equal(read.moneyIgnored, false);
  });
});

describe("replacing a save keeps the previous bytes", () => {
  it("copies the live file aside before a same-size or larger replace", () => {
    const plan = planSaveReplace({
      targetExists: true,
      previous: "{\"v\":8}",
      next: "{\"v\":8,\"extra\":true}",
      siblingNames: ["backup.stvault", "backup.os"],
    });
    assert.equal(plan.backup, true);
    assert.equal(plan.replace, true);
    assert.deepEqual(plan.keepSiblings, ["backup.stvault"]);
  });

  it("backs up and does not replace when the new file is shorter", () => {
    const plan = planSaveReplace({
      targetExists: true,
      previous: "{\"v\":8,\"addresses\":[1]}",
      next: "{}",
    });
    assert.equal(plan.backup, true);
    assert.equal(plan.replace, false);
  });

  it("does not invent a backup when the file is new", () => {
    const plan = planSaveReplace({
      targetExists: false,
      previous: null,
      next: "{}",
    });
    assert.equal(plan.backup, false);
    assert.equal(plan.replace, true);
  });
});
