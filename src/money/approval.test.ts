import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyHelper, setHelperEnabled } from "./helper";
import type { PlanContext } from "./plan";
import {
  commitHelperSpend,
  interpret,
  sendIfApproved,
  submitApprovedPlan,
} from "./plan";
import { parseRequest } from "./parse";

const MOM = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const COINBASE = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  const helper = setHelperEnabled(emptyHelper("2026-10-01"), true, "50", "2026-10-01", 1);
  return {
    contacts: [
      { id: "mom", label: "Mom", publicKey: MOM, memo: "", kind: "private" },
      {
        id: "cb",
        label: "Card deposit",
        publicKey: COINBASE,
        memo: "memo99",
        kind: "exchange",
      },
    ],
    coinbaseCardContactId: "cb",
    rateUsdPerXlm: "0.25",
    feeStroops: 100,
    helper,
    today: "2026-10-01",
    bills: [],
    paymentMethods: [],
    nowMs: 1_700_000_000_000,
    ...overrides,
  };
}

test("plain requests are understood without a network", () => {
  assert.deepEqual(parseRequest("I need $10 to spend"), {
    intent: "spend",
    amount: { value: "10", currency: "USD" },
  });
  assert.deepEqual(parseRequest("send 20 XLM to Mom"), {
    intent: "send",
    amount: { value: "20", currency: "XLM" },
    recipient: "Mom",
  });
  assert.deepEqual(parseRequest("what bills are due this week?"), {
    intent: "bills_due",
    window: "week",
  });
  assert.deepEqual(parseRequest("Top up my card"), {
    intent: "top_up_card",
    amount: null,
  });
  assert.deepEqual(parseRequest("top up my card with $25"), {
    intent: "top_up_card",
    amount: { value: "25", currency: "USD" },
  });
});

test("every new plan requires approval and has not been approved", () => {
  const phrases = [
    "send 20 XLM to Mom",
    "top up my card with $10",
    "I need $10 to spend",
  ];
  for (const phrase of phrases) {
    const result = interpret(phrase, ctx());
    assert.equal(result.type, "plan");
    if (result.type !== "plan") continue;
    assert.equal(result.plan.requiresApproval, true);
    assert.equal(result.plan.approval, null);
    assert.equal(result.plan.submitted, false);
  }
});

test("a send is quoted exactly and stays unsent while offline planning", () => {
  const result = interpret("send 20 XLM to Mom", ctx({ rateUsdPerXlm: null, feeStroops: null }));
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.equal(result.plan.destination, MOM);
  assert.equal(result.plan.amountXlm, "20");
  assert.equal(result.plan.feeIsEstimate, true);
  assert.equal(result.plan.blockers.length, 0);
  assert.match(result.plan.summary, /Nothing is sent until you tap Approve/);
});

test("a dollar top-up shows the live rate, fee, and exact XLM", () => {
  const result = interpret("top up my card with $10", ctx());
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.equal(result.plan.intent, "card_topup");
  assert.equal(result.plan.destination, COINBASE);
  assert.equal(result.plan.memo, "memo99");
  assert.equal(result.plan.amountXlm, "40");
  assert.equal(result.plan.rateUsdPerXlm, "0.25");
  assert.equal(result.plan.feeXlm, "0.00001");
  assert.equal(result.plan.totalXlm, "40.00001");
  assert.deepEqual(result.plan.blockers, []);
});

test("dollar plans stay offline when the rate has not been loaded", () => {
  const result = interpret("top up my card with $10", ctx({ rateUsdPerXlm: null }));
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.equal(result.plan.amountXlm, null);
  assert.ok(result.plan.blockers.includes("needs_rate"));
});

test("submit refuses every unapproved plan and does not call the broadcaster", async () => {
  const phrases = ["send 20 XLM to Mom", "top up my card with $10", "I need $10 to spend"];
  for (const phrase of phrases) {
    const result = interpret(phrase, ctx());
    assert.equal(result.type, "plan");
    if (result.type !== "plan") continue;
    let calls = 0;
    const outcome = await submitApprovedPlan(result.plan, async () => {
      calls += 1;
      return { ok: true, hash: "should-not-run" };
    });
    assert.equal(calls, 0);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.plan.submitted, false);
    assert.ok(outcome.code === "approval_required" || outcome.code === "not_a_send");
  }
});

test("a cancelled biometric check does not send", async () => {
  const result = interpret("send 20 XLM to Mom", ctx());
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  let calls = 0;
  const outcome = await sendIfApproved(
    result.plan,
    { ok: false, method: "biometric", at: Date.now() },
    async () => {
      calls += 1;
      return { ok: true };
    },
  );
  assert.equal(calls, 0);
  assert.equal(outcome.code, "approval_required");
});

test("Approve is what signs and sends, once", async () => {
  const result = interpret("send 20 XLM to Mom", ctx());
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  const seen: string[] = [];
  const broadcast = async (input: { amountXlm: string; destination: string; memo: string }) => {
    seen.push(`${input.destination}|${input.amountXlm}|${input.memo}`);
    return { ok: true, hash: "abc" };
  };
  const outcome = await sendIfApproved(
    result.plan,
    { ok: true, method: "pin", at: 50 },
    broadcast,
  );
  assert.equal(outcome.ok, true);
  assert.deepEqual(seen, [`${MOM}|20|`]);
  assert.equal(outcome.plan.submitted, true);
  assert.equal(outcome.plan.approval?.method, "pin");

  let second = 0;
  const again = await submitApprovedPlan(outcome.plan, async () => {
    second += 1;
    return { ok: true };
  });
  assert.equal(second, 0);
  assert.equal(again.code, "already_submitted");
});

test("an approved card top-up sends the exact XLM to the saved contact", async () => {
  const result = interpret("top up my card with $10", ctx());
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  let amount = "";
  let memo = "";
  const outcome = await sendIfApproved(
    result.plan,
    { ok: true, method: "biometric", at: 60 },
    async (input) => {
      amount = input.amountXlm;
      memo = input.memo;
      assert.equal(input.destination, COINBASE);
      assert.equal(input.kindId, "exchange");
      return { ok: true, hash: "topup" };
    },
  );
  assert.equal(outcome.ok, true);
  assert.equal(amount, "40");
  assert.equal(memo, "memo99");
});

test("helper spending never broadcasts, even after approval", async () => {
  const result = interpret("I need $10 to spend", ctx());
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.equal(result.plan.intent, "helper_spend");
  assert.equal(result.plan.amountXlm, "40");
  assert.equal(result.plan.destination, null);

  let calls = 0;
  const broadcast = async () => {
    calls += 1;
    return { ok: true };
  };
  const blocked = await sendIfApproved(
    result.plan,
    { ok: true, method: "biometric", at: 70 },
    broadcast,
  );
  assert.equal(calls, 0);
  assert.equal(blocked.code, "not_a_send");

  const helper = ctx().helper;
  const unapproved = commitHelperSpend(result.plan, helper, "2026-10-01", 80);
  assert.equal(unapproved.ok, false);
  assert.equal(unapproved.code, "approval_required");
  assert.equal(unapproved.helper.spentUsd, helper.spentUsd);

  const reserved = commitHelperSpend(
    { ...result.plan, approval: { method: "biometric", at: 70 } },
    helper,
    "2026-10-01",
    80,
  );
  assert.equal(reserved.ok, true);
  assert.equal(reserved.helper.spentUsd, "10");
  assert.equal(calls, 0);
});

test("a forged or blocked approval cannot submit", async () => {
  const result = interpret("send 5 XLM to Nobody", ctx());
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  let calls = 0;
  const broadcast = async () => {
    calls += 1;
    return { ok: true };
  };
  const forged = await submitApprovedPlan(
    { ...result.plan, approval: { method: "biometric", at: Number.NaN } },
    broadcast,
  );
  assert.equal(forged.code, "approval_required");
  const forced = await sendIfApproved(
    result.plan,
    { ok: true, method: "biometric", at: 90 },
    broadcast,
  );
  assert.equal(forced.code, "blocked");
  assert.equal(calls, 0);
});

test("top up without a saved card-deposit contact does not send", async () => {
  const result = interpret("top up my card with $10", ctx({
    coinbaseCardContactId: null,
    contacts: [{ id: "mom", label: "Mom", publicKey: MOM, memo: "", kind: "private" }],
  }));
  assert.equal(result.type, "plan");
  if (result.type !== "plan") return;
  assert.ok(result.plan.blockers.includes("needs_contact"));
  let calls = 0;
  const outcome = await sendIfApproved(
    result.plan,
    { ok: true, method: "pin", at: 100 },
    async () => {
      calls += 1;
      return { ok: true };
    },
  );
  assert.equal(calls, 0);
  assert.equal(outcome.ok, false);
});
