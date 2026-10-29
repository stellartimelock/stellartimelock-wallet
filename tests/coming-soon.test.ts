import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { COMING_SOON_ITEMS, getComingSoonItem } from "../src/coming-soon/items.ts";

describe("coming soon placeholders", () => {
  it("lists payouts and anonymized shopping trends only", () => {
    assert.deepEqual(
      COMING_SOON_ITEMS.map((item) => item.id),
      ["payouts", "shopping-trends"],
    );
    assert.equal(getComingSoonItem("payouts").label, "Payouts");
    assert.equal(
      getComingSoonItem("shopping-trends").label,
      "Anonymized shopping trends",
    );
  });

  it("labels each item Coming soon and says it is not available yet", () => {
    for (const item of COMING_SOON_ITEMS) {
      assert.match(item.sublabel, /not available yet/i);
      assert.match(item.screenBody, /Coming soon/i);
      assert.match(item.screenBody, /not available yet/i);
    }
  });

  it("does not invent balances, trends, or receipt data", () => {
    const banned = /\$\d|fake balance|sample receipt|example trend|sample data/i;
    for (const item of COMING_SOON_ITEMS) {
      assert.doesNotMatch(item.sublabel, banned);
      assert.doesNotMatch(item.screenBody, banned);
    }
  });

  it("does not mount Coming soon on Home or Settings", () => {
    const wallet = readFileSync("app/(tabs)/wallet.tsx", "utf8");
    const settings = readFileSync("app/settings.tsx", "utf8");
    const section = readFileSync("src/coming-soon/ComingSoonSection.tsx", "utf8");
    assert.doesNotMatch(wallet, /ComingSoonSection/);
    assert.doesNotMatch(settings, /ComingSoonSection/);
    assert.doesNotMatch(wallet, /wallet-bills-button/);
    assert.match(section, /defaultCollapsed/);
    assert.match(section, /Later/);
  });
});
