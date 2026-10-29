import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyHelper } from "./helper";
import { mergeMoneySave, readMoneyDocument, type MoneySaveFile } from "./save-file";

function file(overrides: Partial<MoneySaveFile> = {}): MoneySaveFile {
  return {
    v: 1,
    writtenAt: 10,
    bills: [],
    paymentMethods: [],
    helper: emptyHelper("2026-10-01", 10),
    coinbaseCardContactId: null,
    ...overrides,
  };
}

test("a v1 save round-trips and ignores fields it does not know", () => {
  const raw = {
    v: 1,
    writtenAt: 5,
    bills: [
      {
        id: "power",
        name: "Power",
        amount: "40",
        dueDate: "2026-10-02",
        autopay: false,
        extraSecret: "4111111111111111",
      },
    ],
    paymentMethods: [
      {
        id: "card",
        kind: "card",
        nickname: "Daily",
        last4: "1111",
        brand: "visa",
        vaultRef: "sv_1",
        cvv: "123",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    helper: emptyHelper("2026-10-01", 5),
    futureFeature: { whatever: true },
  };
  const read = readMoneyDocument(raw);
  assert.equal(read.present, true);
  assert.equal(read.file.bills.length, 0);
  assert.equal(read.file.paymentMethods.length, 0);
  assert.equal(JSON.stringify(read.file).includes("4111111111111111"), false);
  assert.equal(JSON.stringify(read.file).includes("cvv"), false);
});

test("import keeps local bills and restore drops them when the save replaces the file", () => {
  const local = file({
    writtenAt: 1,
    bills: [
      {
        id: "local",
        name: "Local",
        amount: "5",
        dueDate: "2026-10-02",
        autopay: false,
        paymentMethodId: null,
        payTiming: "due_date",
        payUrl: "",
        payeeAddress: "",
        payeeMemo: "",
        reminderDaysBefore: 3,
        repeat: "none",
        createdAt: 1,
        updatedAt: 1,
        paidOn: null,
      },
    ],
  });
  const incoming = file({
    writtenAt: 20,
    bills: [
      {
        id: "remote",
        name: "Remote",
        amount: "9",
        dueDate: "2026-10-04",
        autopay: true,
        paymentMethodId: null,
        payTiming: "now",
        payUrl: "",
        payeeAddress: "",
        payeeMemo: "",
        reminderDaysBefore: 1,
        repeat: "monthly",
        createdAt: 2,
        updatedAt: 20,
        paidOn: null,
      },
    ],
    coinbaseCardContactId: "cb",
  });
  const imported = mergeMoneySave(local, incoming, "import");
  assert.deepEqual(imported.bills.map((b) => b.id).sort(), ["local", "remote"]);
  assert.equal(imported.coinbaseCardContactId, "cb");

  const restored = mergeMoneySave(local, incoming, "restore");
  assert.deepEqual(restored.bills.map((b) => b.id), ["remote"]);
});

test("an empty object and a stub-only bill list are not a money file", () => {
  assert.equal(readMoneyDocument({}).present, false);
  assert.equal(readMoneyDocument({ bills: [{ id: "x", createdAt: 1 }] }).present, false);
  assert.equal(readMoneyDocument(null).present, false);
});
