import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DAILY_XLM, DEFAULT_PER_TX_XLM } from "../src/tap-pay/constants.ts";
import {
  assessLimitSettings,
  assessTapLimits,
  DEFAULT_TAP_LIMITS,
  isFirstTimeRecipient,
} from "../src/tap-pay/limits.ts";
import { parseAmountToStroops } from "../src/tap-pay/money.ts";

describe("tap-to-pay limits", () => {
  it("ships modest defaults", () => {
    const perTx = parseAmountToStroops(DEFAULT_PER_TX_XLM);
    const daily = parseAmountToStroops(DEFAULT_DAILY_XLM);
    assert.ok(perTx != null && daily != null);
    assert.ok(perTx <= 50n * 10_000_000n);
    assert.ok(daily <= 200n * 10_000_000n);
    assert.ok(perTx <= daily);
    assert.equal(DEFAULT_TAP_LIMITS.perTxXlm, "25.0000000");
    assert.equal(DEFAULT_TAP_LIMITS.dailyXlm, "100.0000000");
  });

  it("allows a payment on the limit and rejects one past it", () => {
    const onLimit = assessTapLimits({
      amount: "25",
      limits: DEFAULT_TAP_LIMITS,
      spentToday: "0",
    });
    assert.equal(onLimit.ok, true);

    const overTx = assessTapLimits({
      amount: "25.0000001",
      limits: DEFAULT_TAP_LIMITS,
      spentToday: "0",
    });
    assert.equal(overTx.ok, false);
    if (!overTx.ok) assert.equal(overTx.code, "per_tx");

    const overDay = assessTapLimits({
      amount: "20",
      limits: DEFAULT_TAP_LIMITS,
      spentToday: "90",
    });
    assert.equal(overDay.ok, false);
    if (!overDay.ok) assert.equal(overDay.code, "daily");

    const bad = assessTapLimits({
      amount: "0",
      limits: DEFAULT_TAP_LIMITS,
      spentToday: "0",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "invalid_amount");
  });

  it("refuses a per-payment limit above the daily limit", () => {
    const bad = assessLimitSettings("80", "50");
    assert.equal(bad.ok, false);
    const zero = assessLimitSettings("0", "100");
    assert.equal(zero.ok, false);
    const ok = assessLimitSettings("10", "40");
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.perTxXlm, "10.0000000");
      assert.equal(ok.dailyXlm, "40.0000000");
    }
  });

  it("warns the first time a recipient is paid", () => {
    const destination = "G".padEnd(56, "A");
    assert.equal(isFirstTimeRecipient({
      destination,
      knownRecipients: [],
      savedAddresses: [],
    }), true);
    assert.equal(isFirstTimeRecipient({
      destination,
      knownRecipients: [destination],
      savedAddresses: [],
    }), false);
    assert.equal(isFirstTimeRecipient({
      destination,
      knownRecipients: [],
      savedAddresses: [destination],
    }), false);
    assert.equal(isFirstTimeRecipient({
      destination,
      knownRecipients: [],
      savedAddresses: [],
      whitelistedDestinations: [destination],
    }), false);
  });
});
