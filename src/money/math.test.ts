import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatUsd,
  quoteUsdInXlm,
  quoteXlm,
  xlmToBroadcastNumber,
} from "./math";

test("ten dollars at a quarter is exactly 40 XLM", () => {
  const quote = quoteUsdInXlm("10", "0.25", 100);
  assert.equal(quote.amountXlm, "40");
  assert.equal(quote.amountUsd, "10");
  assert.equal(quote.rateUsdPerXlm, "0.25");
  assert.equal(quote.feeXlm, "0.00001");
  assert.equal(quote.totalXlm, "40.00001");
  assert.equal(quote.amountStroops, "400000000");
  assert.equal(quote.feeStroops, "100");
  assert.equal(quote.feeIsEstimate, false);
});

test("$10 at $0.12 rounds half-up to the nearest stroop", () => {
  const quote = quoteUsdInXlm("10", "0.12", 100);
  // 10 / 0.12 = 83.3333...333 and the 8th decimal is 3, so stay at 7 places.
  assert.equal(quote.amountXlm, "83.3333333");
  assert.equal(quote.amountStroops, "833333333");
  assert.equal(quote.totalXlm, "83.3333433");
});

test("two dollars at a rate of 3 rounds the repeating fraction up", () => {
  const quote = quoteUsdInXlm("2", "3", 0);
  // 2/3 = 0.6666...666 with the next digit 6, so the 7th place rounds up.
  assert.equal(quote.amountXlm, "0.6666667");
  assert.equal(quote.feeXlm, "0");
  assert.equal(quote.totalXlm, "0.6666667");
});

test("a missing fee uses the 100-stroop protocol minimum and says so", () => {
  const quote = quoteXlm("20", "0.5", null);
  assert.equal(quote.amountXlm, "20");
  assert.equal(quote.amountUsd, "10");
  assert.equal(quote.feeXlm, "0.00001");
  assert.equal(quote.totalXlm, "20.00001");
  assert.equal(quote.feeIsEstimate, true);
});

test("XLM quotes work with no rate at all", () => {
  const quote = quoteXlm("1.5", null, 100);
  assert.equal(quote.amountXlm, "1.5");
  assert.equal(quote.amountUsd, null);
  assert.equal(quote.rateUsdPerXlm, null);
});

test("zero rate, zero amount, and sub-stroop amounts are refused", () => {
  assert.throws(() => quoteUsdInXlm("10", "0", 100), /Rate/);
  assert.throws(() => quoteUsdInXlm("0", "0.25", 100), /greater than zero/);
  assert.throws(() => quoteUsdInXlm("0.0000001", "10", 100), /stroop/);
  assert.throws(() => quoteXlm("-1", "0.25", 100), /decimal/);
});

test("broadcast numbers round-trip through toFixed(7)", () => {
  for (const amount of ["40", "83.3333333", "0.0000001", "0.6666667", "1234.5"]) {
    const n = xlmToBroadcastNumber(amount);
    const back = n.toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
    assert.equal(back, amount);
  }
});

test("USD display is half-up to cents", () => {
  assert.equal(formatUsd("10"), "10.00");
  assert.equal(formatUsd("1.005"), "1.01");
  assert.equal(formatUsd("0.1"), "0.10");
});
