import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { SaveOverwriteDeclined, type SaveFs } from "../src/utils/protected-save.ts";
import { readTapPaySave, writeTapPaySave } from "../src/tap-pay/history.ts";
import { emptyTapPaySave, withPayment, type TapPayment } from "../src/tap-pay/save.ts";

function memoryFs(): SaveFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir() {},
    async exists(path) {
      return files.has(path);
    },
    async read(path) {
      const value = files.get(path);
      if (value == null) throw new Error("missing");
      return value;
    },
    async write(path, contents) {
      files.set(path, contents);
    },
    async remove(path) {
      files.delete(path);
    },
    async move(from, to) {
      const value = files.get(from);
      if (value == null) throw new Error("missing");
      files.set(to, value);
      files.delete(from);
    },
    async copy(from, to) {
      const value = files.get(from);
      if (value == null) throw new Error("missing");
      files.set(to, value);
    },
    async list(directory) {
      const prefix = directory.endsWith("/") ? directory : `${directory}/`;
      const names: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length);
        if (!name.includes("/")) names.push(name);
      }
      return names;
    },
  };
}

function payment(nonce: string, amount: string): TapPayment {
  return {
    id: nonce,
    role: "pay",
    network: "testnet",
    destination: Keypair.random().publicKey(),
    source: Keypair.random().publicKey(),
    amount,
    memo: "coffee",
    chainMemo: `n:${nonce}:coffee`,
    hash: nonce.padEnd(64, "a"),
    ledger: 10,
    createdAt: 1_700_000_000_000,
    name: "Ada",
  };
}

describe("tap-pay history saves", () => {
  it("writes atomically, keeps a backup, and refuses a shrink", async () => {
    const fs = memoryFs();
    const directory = "mem/";
    let doc = withPayment(emptyTapPaySave(1), payment("abcdef012345", "1.5000000"), 1);
    await writeTapPaySave({ fs, directory, next: doc });
    const loaded = await readTapPaySave(fs, directory);
    assert.equal(loaded.payments.length, 1);
    assert.equal(loaded.payments[0].amount, "1.5000000");
    assert.equal(loaded.knownRecipients.length, 1);

    doc = withPayment(loaded, payment("1234567890ab", "2.0000000"), 2);
    await writeTapPaySave({ fs, directory, next: doc });
    assert.equal(fs.files.has("mem/tap-pay.json.bak1"), true);
    const again = await readTapPaySave(fs, directory);
    assert.equal(again.payments.length, 2);

    await assert.rejects(
      () => writeTapPaySave({ fs, directory, next: emptyTapPaySave(3) }),
      (error: unknown) => error instanceof SaveOverwriteDeclined && error.reason === "shrink",
    );
    const kept = await readTapPaySave(fs, directory);
    assert.equal(kept.payments.length, 2);
  });
});
