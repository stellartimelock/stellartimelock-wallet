import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatUnlockDate, formatTimestamp } from "../src/vault/countdown.ts";
import { US_DATE_LOCALE, formatUsDate } from "../src/utils/us-date.ts";

describe("US dates", () => {
  it("formats unlock dates in en-US month/day/year order", () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const expected = formatUsDate(new Date(future * 1000), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    assert.equal(formatUnlockDate(future), expected);
    assert.equal(US_DATE_LOCALE, "en-US");
    assert.match(expected, /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it("formats timestamps with the en-US calendar", () => {
    const ts = Math.floor(Date.now() / 1000);
    const expected = new Date(ts * 1000).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    assert.equal(formatTimestamp(ts), expected);
  });
});
