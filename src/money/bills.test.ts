import assert from "node:assert/strict";
import { test } from "node:test";

import {
  autopayDue,
  billReminderPlans,
  billsDueThisWeek,
  markBillPaid,
  parseBillsCsv,
  sanitizeBill,
  sanitizePaymentMethod,
  scheduleBill,
  type Bill,
} from "./bills";
import { emptyHelper, setHelperEnabled, sweepHelper } from "./helper";
import { interpret, sendIfApproved } from "./plan";
import { buildCardFillRequest } from "./vault-fill";
import { readMoneyDocument } from "./save-file";

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "rent",
    name: "Rent",
    amount: "1200",
    dueDate: "2026-10-03",
    autopay: false,
    paymentMethodId: "visa",
    payTiming: "due_date",
    payUrl: "https://pay.example/rent",
    payeeAddress: "",
    payeeMemo: "",
    reminderDaysBefore: 3,
    repeat: "none",
    createdAt: 1,
    updatedAt: 1,
    paidOn: null,
    ...overrides,
  };
}

test("scheduling distinguishes pay now, due date, reminders, and overdue", () => {
  const later = scheduleBill(bill({ dueDate: "2026-10-08", reminderDaysBefore: 3 }), "2026-10-01");
  assert.equal(later.status, "upcoming");
  assert.equal(later.remindOn, "2026-10-05");
  assert.equal(later.payOn, "2026-10-08");
  assert.equal(later.reminderDue, false);
  assert.equal(later.needsApproval, true);

  const remind = scheduleBill(bill({ dueDate: "2026-10-08", reminderDaysBefore: 3 }), "2026-10-05");
  assert.equal(remind.reminderDue, true);
  assert.equal(remind.status, "upcoming");

  const due = scheduleBill(bill({ dueDate: "2026-10-08" }), "2026-10-08");
  assert.equal(due.status, "due");
  assert.equal(due.payOn, "2026-10-08");

  const overdue = scheduleBill(bill({ dueDate: "2026-10-08" }), "2026-10-09");
  assert.equal(overdue.status, "overdue");

  const payNow = scheduleBill(bill({ dueDate: "2026-10-20", payTiming: "now" }), "2026-10-01");
  assert.equal(payNow.payOn, "2026-10-01");
  assert.equal(payNow.status, "upcoming");
  assert.equal(payNow.needsApproval, true);
});

test("this week is the Monday–Sunday window and skips paid bills", () => {
  // 2026-10-01 is a Thursday. The week is Sep 28 through Oct 4.
  const bills = [
    bill({ id: "a", name: "Electric", dueDate: "2026-10-03" }),
    bill({ id: "b", name: "Next", dueDate: "2026-10-06" }),
    bill({ id: "c", name: "Old", dueDate: "2026-09-28", paidOn: "2026-09-28" }),
    bill({ id: "d", name: "Internet", dueDate: "2026-09-30" }),
  ];
  const due = billsDueThisWeek(bills, "2026-10-01");
  assert.deepEqual(due.map((b) => b.id), ["d", "a"]);
});

test("autopay prepares a plan on the due date and still requires approval", async () => {
  const ready = bill({
    autopay: true,
    payTiming: "due_date",
    dueDate: "2026-10-01",
    payeeAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    paymentMethodId: "xlm",
  });
  const waiting = bill({ id: "later", autopay: true, dueDate: "2026-10-20" });
  const schedules = autopayDue([ready, waiting], "2026-10-01");
  assert.equal(schedules.length, 1);
  assert.equal(schedules[0].billId, "rent");
  assert.equal(schedules[0].needsApproval, true);
  assert.equal("submitted" in schedules[0], false);

  const result = interpret("what bills are due this week?", {
    contacts: [],
    coinbaseCardContactId: null,
    rateUsdPerXlm: null,
    feeStroops: null,
    helper: emptyHelper("2026-10-01"),
    today: "2026-10-01",
    bills: [ready],
    paymentMethods: [
      { id: "xlm", kind: "xlm", nickname: "XLM", createdAt: 1, updatedAt: 1 },
    ],
  });
  assert.equal(result.type, "bills");
  if (result.type !== "bills") return;
  assert.match(result.lines[0], /still needs Approve/);

  let calls = 0;
  const sent = await sendIfApproved(
    {
      id: "plan_bill",
      intent: "send",
      summary: "",
      recipientLabel: "Rent",
      destination: ready.payeeAddress,
      memo: "",
      destinationKind: "private",
      amountXlm: "1",
      amountUsd: null,
      rateUsdPerXlm: null,
      feeXlm: "0.00001",
      feeIsEstimate: true,
      totalXlm: "1.00001",
      blockers: [],
      requiresApproval: true,
      approval: null,
      submitted: false,
    },
    { ok: false, method: "biometric", at: 1 },
    async () => {
      calls += 1;
      return { ok: true };
    },
  );
  assert.equal(calls, 0);
  assert.equal(sent.code, "approval_required");
});

test("reminders fire before the due date and skip paid or past alarms", () => {
  const upcoming = bill({ dueDate: "2026-10-08", reminderDaysBefore: 2 });
  const plans = billReminderPlans([upcoming], "2026-10-01", Date.UTC(2026, 9, 1, 12));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].billId, "rent");
  assert.equal(plans[0].fireAtMs, Date.UTC(2026, 9, 6, 9));

  const paid = markBillPaid(upcoming, "2026-10-01", 5);
  assert.equal(paid.paidOn, "2026-10-01");
  assert.equal(billReminderPlans([paid], "2026-10-01", Date.UTC(2026, 9, 1)).length, 0);

  const monthly = markBillPaid(bill({ repeat: "monthly", dueDate: "2026-01-31" }), "2026-01-31", 6);
  assert.equal(monthly.dueDate, "2026-02-28");
});

test("CSV import and card records reject full card numbers", () => {
  const csv = [
    "name,amount,dueDate,autopay,payTiming,reminderDaysBefore",
    "Electric,85.40,2026-10-03,yes,due_date,2",
    "Bad,-5,2026-10-03,no,now,1",
  ].join("\n");
  const imported = parseBillsCsv(csv, 10);
  assert.equal(imported.bills.length, 1);
  assert.equal(imported.bills[0].name, "Electric");
  assert.equal(imported.bills[0].amount, "85.4");
  assert.equal(imported.bills[0].autopay, true);
  assert.equal(imported.bills[0].reminderDaysBefore, 2);
  assert.equal(imported.errors.length, 1);

  const card = sanitizePaymentMethod({
    id: "visa",
    kind: "card",
    nickname: "Rent card",
    last4: "4242",
    brand: "visa",
    vaultRef: "sv_rent",
    createdAt: 1,
    updatedAt: 1,
  });
  assert.equal(card.ok, true);

  const pan = sanitizePaymentMethod({
    id: "visa",
    kind: "card",
    nickname: "Rent card",
    last4: "4242",
    brand: "visa",
    vaultRef: "sv_rent",
    number: "4242424242424242",
    createdAt: 1,
    updatedAt: 1,
  });
  assert.equal(pan.ok, false);

  const hidden = sanitizeBill({
    ...bill(),
    payUrl: "https://pay.example/4242424242424242",
  });
  assert.equal(hidden.ok, false);
});

test("card pay opens a fill request only after Approve to Fill", () => {
  const method = sanitizePaymentMethod({
    id: "visa",
    kind: "card",
    nickname: "Rent card",
    last4: "4242",
    brand: "visa",
    vaultRef: "sv_rent",
    createdAt: 1,
    updatedAt: 1,
  });
  assert.equal(method.ok, true);
  if (!method.ok) return;
  const rent = bill();
  const denied = buildCardFillRequest({ bill: rent, method: method.method, approval: null });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, "approval_required");
  assert.equal(JSON.stringify(denied).includes("4242"), false);

  const allowed = buildCardFillRequest({
    bill: rent,
    method: method.method,
    approval: { method: "biometric", at: 20 },
  });
  assert.equal(allowed.ok, true);
  if (!allowed.ok) return;
  assert.equal(allowed.request.payUrl, "https://pay.example/rent");
  assert.equal(allowed.request.last4, "4242");
  assert.equal(allowed.request.vaultRef, "sv_rent");
  assert.equal(JSON.stringify(allowed.request).includes("4242424242424242"), false);

  const smuggled = buildCardFillRequest({
    bill: rent,
    method: { ...method.method, number: "4242424242424242" } as unknown as typeof method.method,
    approval: { method: "pin", at: 21 },
  });
  assert.equal(smuggled.ok, false);
  if (!smuggled.ok) assert.equal(smuggled.code, "card_secret");
});

test("helper spending resets when a new week starts", () => {
  const helper = {
    ...setHelperEnabled(emptyHelper("2026-09-21"), true, "50", "2026-09-21", 1),
    spentUsd: "40",
    weekStartedOn: "2026-09-21",
  };
  const result = interpret("I need $20 to spend", {
    contacts: [],
    coinbaseCardContactId: null,
    rateUsdPerXlm: "0.25",
    feeStroops: 100,
    helper,
    today: "2026-10-01",
    bills: [],
    paymentMethods: [],
  });
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.equal(result.plan.blockers.includes("over_weekly_limit"), false);
  assert.equal(result.plan.amountXlm, "80");
});

test("freeze blocks a set-aside and sweep does not create a transfer", () => {
  let helper = setHelperEnabled(emptyHelper("2026-10-01"), true, "50", "2026-10-01", 1);
  helper = { ...helper, frozen: true, allocatedXlm: "12.5" };
  const result = interpret("I need $10 to spend", {
    contacts: [],
    coinbaseCardContactId: null,
    rateUsdPerXlm: "0.25",
    feeStroops: 100,
    helper,
    today: "2026-10-01",
    bills: [],
    paymentMethods: [],
  });
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.ok(result.plan.blockers.includes("helper_frozen"));
  assert.equal(result.plan.destination, null);

  const swept = sweepHelper(helper, 30);
  assert.equal(swept.sweptXlm, "12.5");
  assert.equal(swept.helper.allocatedXlm, "0");
  assert.equal("destination" in swept, false);
});

test("older saves without a money document are left alone", () => {
  const legacy = {
    v: 8,
    writtenAt: 1,
    device: "stellar-timelock-wallet",
    notes: [],
    bills: [{ id: "stub", createdAt: 1 }],
    addresses: [],
  };
  const read = readMoneyDocument(legacy);
  assert.equal(read.present, false);
  assert.equal(read.file.bills.length, 0);

  const current = readMoneyDocument({
    v: 1,
    writtenAt: 2,
    bills: [bill()],
    paymentMethods: [],
    helper: emptyHelper("2026-10-01"),
    coinbaseCardContactId: null,
  });
  assert.equal(current.present, true);
  assert.equal(current.file.bills[0].name, "Rent");
  assert.equal(current.file.bills[0].payTiming, "due_date");
});
