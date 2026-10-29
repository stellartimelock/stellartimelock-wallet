import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  accountRequiresMemo,
  checkExchangeMemo,
  findDeposits,
  memoFitsText,
  parseKnownDeposits,
  upsertDeposit,
  type KnownDeposit,
} from "../src/send/exchange-memo-gate.ts";

const SS = `G${"S".repeat(55)}`; // stands in for SimpleSwap's shared XLM deposit
const FRIEND = `G${"F".repeat(55)}`;

const dep = (p: Partial<KnownDeposit> = {}): KnownDeposit => ({
  address: SS,
  memo: "123456789",
  provider: "simpleswap",
  exchangeId: "abc",
  createdAt: 1000,
  ...p,
});

describe("swap auto-send requiredMemo", () => {
  it("passes when the memo equals the exchange memo", () => {
    assert.deepEqual(
      checkExchangeMemo({ destination: SS, memo: "123456789", requiredMemo: "123456789" }),
      { ok: true },
    );
  });
  it("blocks a missing memo", () => {
    const r = checkExchangeMemo({ destination: SS, memo: "", requiredMemo: "123456789" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "exchange_memo_missing");
  });
  it("blocks a wrong memo", () => {
    const r = checkExchangeMemo({ destination: SS, memo: "999", requiredMemo: "123456789" });
    assert.equal(!r.ok && r.reason, "exchange_memo_mismatch");
  });
  it("refuses to send when the provider returned no memo", () => {
    for (const req of [null, "", "  "]) {
      const r = checkExchangeMemo({ destination: SS, memo: "", requiredMemo: req });
      assert.equal(!r.ok && r.reason, "exchange_memo_unknown");
    }
  });
  it("blocks memos over 28 bytes", () => {
    const long = "x".repeat(29);
    const r = checkExchangeMemo({ destination: SS, memo: long, requiredMemo: long });
    assert.equal(!r.ok && r.reason, "memo_too_long");
    assert.equal(memoFitsText("x".repeat(28)), true);
  });
});

describe("hard block on known exchange deposit addresses", () => {
  it("blocks a memo-less send to a known deposit even with the Private chip", () => {
    const r = checkExchangeMemo({
      destination: SS,
      memo: "",
      kindId: "private",
      knownDeposits: [dep()],
    });
    assert.equal(!r.ok && r.reason, "exchange_memo_missing");
  });
  it("matches addresses case/whitespace-insensitively", () => {
    const r = checkExchangeMemo({
      destination: ` ${SS.toLowerCase()} `,
      memo: "",
      knownDeposits: [dep()],
    });
    assert.equal(r.ok, false);
  });
  it("allows a send with a memo", () => {
    assert.equal(
      checkExchangeMemo({ destination: SS, memo: "123456789", knownDeposits: [dep()] }).ok,
      true,
    );
  });
  it("does not block unrelated private addresses", () => {
    assert.equal(
      checkExchangeMemo({ destination: FRIEND, memo: "", kindId: "private", knownDeposits: [dep()] }).ok,
      true,
    );
  });
  it("blocks SEP-29 memo_required accounts without a memo", () => {
    const r = checkExchangeMemo({ destination: FRIEND, memo: "", destinationRequiresMemo: true });
    assert.equal(!r.ok && r.reason, "account_memo_required");
  });
  it("keeps the exchange/casino chip rule", () => {
    for (const kindId of ["exchange", "casino"]) {
      const r = checkExchangeMemo({ destination: FRIEND, memo: "", kindId });
      assert.equal(!r.ok && r.reason, "memo_required_kind");
    }
    assert.equal(checkExchangeMemo({ destination: FRIEND, memo: "", kindId: "donation" }).ok, true);
  });
});

describe("SEP-29 + registry helpers", () => {
  it("reads config.memo_required", () => {
    assert.equal(accountRequiresMemo({ "config.memo_required": "MQ==" }), true);
    assert.equal(accountRequiresMemo({ other: "MQ==" }), false);
    assert.equal(accountRequiresMemo(undefined), false);
  });
  it("upserts, dedupes and caps the registry", () => {
    let list: KnownDeposit[] = [];
    list = upsertDeposit(list, dep({ memo: "1", createdAt: 1 }));
    list = upsertDeposit(list, dep({ memo: "1", createdAt: 5 }));
    list = upsertDeposit(list, dep({ memo: "2", createdAt: 3 }));
    assert.equal(list.length, 2);
    assert.deepEqual(findDeposits(list, SS).map((d) => d.memo), ["1", "2"]);
    for (let i = 0; i < 60; i++) list = upsertDeposit(list, dep({ memo: String(100 + i), createdAt: 10 + i }));
    assert.equal(list.length, 50);
  });
  it("parses only well-formed persisted entries", () => {
    assert.deepEqual(parseKnownDeposits("not json"), []);
    assert.deepEqual(parseKnownDeposits(JSON.stringify([{ address: "bad" }])), []);
    assert.equal(parseKnownDeposits(JSON.stringify([dep()])).length, 1);
  });
});

describe("wiring contract", () => {
  const swap = readFileSync(new URL("../app/swap.tsx", import.meta.url), "utf8");
  const send = readFileSync(new URL("../app/send.tsx", import.meta.url), "utf8");
  const broadcast = readFileSync(new URL("../src/send/broadcast.ts", import.meta.url), "utf8");

  it("swap signs in-app with the exchange memo instead of handing it to the user", () => {
    assert.match(swap, /broadcastPayment\(\{[\s\S]*?memo: \(created\.payin_extra_id \|\| ""\)\.trim\(\)[\s\S]*?requiredMemo: created\.payin_extra_id \?\? null/);
    assert.doesNotMatch(swap, /pathname: "\/send",\s*params: \{\s*to: created\.payin_address/);
    assert.match(swap, /testID="swap-auto-send-confirm"/);
  });
  it("swap remembers the deposit address + memo", () => {
    assert.match(swap, /rememberDeposit\(\{[\s\S]*?memo: c\.payin_extra_id/);
  });
  it("broadcastPayment enforces the gate for every caller", () => {
    assert.match(broadcast, /loadKnownDeposits\(\)/);
    assert.match(broadcast, /checkExchangeMemo\(/);
    assert.match(broadcast, /accountRequiresMemo\(destJson\?\.data\)/);
    assert.match(broadcast, /requiredMemo\?: string \| null/);
  });
  it("Send screen disables submit for a known deposit without memo", () => {
    assert.match(send, /if \(exchangeMemoBlock\) return true;/);
  });
});
