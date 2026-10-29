import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Branding } from "../constants/branding.ts";

const settings = readFileSync("app/settings.tsx", "utf8");
const wallet = readFileSync("app/(tabs)/wallet.tsx", "utf8");
const appJson = readFileSync("app.json", "utf8");

describe("developer branding label", () => {
  it("keeps the old byline string only so screens can be checked against it", () => {
    assert.equal(Branding.BYLINE, "STL wallet by StellarTimeLock");
  });

  it("does not show the byline, and the app name stays Stellar TimeLock", () => {
    assert.doesNotMatch(settings, /Branding/);
    assert.doesNotMatch(settings, /STL wallet by StellarTimeLock/);
    assert.doesNotMatch(settings, /settings-developer-byline/);
    assert.doesNotMatch(wallet, /Branding/);
    assert.doesNotMatch(wallet, /STL wallet by StellarTimeLock/);
    assert.doesNotMatch(wallet, /wallet-developer-byline/);
    assert.match(appJson, /"name": "Stellar TimeLock"/);
    assert.match(settings, /© StellarTimeLock, LLC/);
  });

  it("hides the other-apps list", () => {
    assert.doesNotMatch(settings, /OTHER APPS BY THIS DEVELOPER/);
    assert.doesNotMatch(settings, /FlipSend|Sourceify|Naturally/);
    assert.doesNotMatch(settings, /AI Text Manager|Lost Context|Digest|Stellar OS/);
  });
});