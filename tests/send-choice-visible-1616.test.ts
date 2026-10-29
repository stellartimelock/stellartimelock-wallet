import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const send = read("../app/send.tsx");
const swap = read("../app/swap.tsx");
const chips = read("../src/send/components/DestinationKindChips.tsx");

describe("1.6.16 send screen: destination type is visible and obvious", () => {
  it("puts DESTINATION TYPE above RECIPIENT ADDRESS in a labeled card", () => {
    const kind = send.indexOf('testID="send-kind-section"');
    const recipient = send.indexOf(">RECIPIENT ADDRESS<");
    assert.ok(kind > 0 && recipient > 0 && kind < recipient);
    assert.match(send, /<Text style=\{styles\.kindSectionLabel\}>DESTINATION TYPE<\/Text>/);
  });
  it("pins the chosen type above the Send button", () => {
    const pinned = send.indexOf('testID="send-kind-pinned"');
    const submit = send.indexOf('testID="send-submit"');
    assert.ok(pinned > 0 && pinned < submit);
    assert.match(send, /Sending to:/);
  });
  it("keeps the existing chip names and order", () => {
    const labels = [...chips.matchAll(/\{ id: "(\w+)", label: "([^"]+)" \}/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(labels, [
      "private:Private Wallet",
      "exchange:Exchange / Custodial",
      "casino:Casino",
      "donation:Donation",
    ]);
  });
  it("fills the selected chip and shows a checkmark", () => {
    assert.match(chips, /chipActive: \{\s*backgroundColor: colors\.cyan,/);
    assert.match(chips, /active \? \(\s*<Feather\s*name="check"/);
    assert.match(chips, /accessibilityState=\{\{ selected: active, checked: active, disabled \}\}/);
  });
  it("keeps Private Wallet as the default", () => {
    assert.match(send, /: "private"\) as DestinationKindId/);
  });
});

describe("1.6.16 exchange lock", () => {
  it("locks the type to Exchange for swap hand-offs and known swap deposits", () => {
    assert.match(send, /const exchangeLocked = params\.kind === "exchange" \|\| isKnownDeposit;/);
    assert.match(send, /if \(exchangeLocked && kindId !== "exchange"\) setKindId\("exchange"\);/);
    assert.match(send, /disabled=\{lockedFromContact \|\| exchangeLocked\}/);
    assert.match(send, /if \(exchangeLocked\) return;/);
  });
  it("keeps 1.6.15 memo protections", () => {
    assert.match(send, /if \(exchangeMemoBlock\) return true;/);
    assert.match(swap, /requiredMemo: created\.payin_extra_id \?\? null/);
    assert.match(swap, /kindId: "exchange",\s*requiredMemo/);
  });
});

describe("1.6.16 swap: HOW WOULD YOU LIKE TO SEND? is near the top", () => {
  it("sits between the safety check and the deposit card", () => {
    const verify = swap.indexOf('testID="swap-verify-card"');
    const choice = swap.indexOf('testID="swap-send-choice"');
    const deposit = swap.indexOf(">SEND EXACTLY<");
    assert.ok(verify > 0 && verify < choice && choice < deposit);
  });
  it("keeps the three options in order and marks Send from Wallet as default", () => {
    const a = swap.indexOf(">Send from Wallet<");
    const b = swap.indexOf(">Show QR code<");
    const c = swap.indexOf(">Copy manually<");
    assert.ok(a > 0 && a < b && b < c);
    assert.match(swap, /styles\.actionCardDefault/);
    assert.match(swap, /testID="swap-action-default-badge"/);
  });
  it("uses a high-contrast label", () => {
    assert.match(swap, /actionSectionLabel: \{\s*color: colors\.text,\s*fontSize: 16,/);
  });
});
