import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const theme = readFileSync("src/theme/index.ts", "utf8");
const appJson = readFileSync("app.json", "utf8");
const colorsXml = readFileSync("android/app/src/main/res/values/colors.xml", "utf8");
const settings = readFileSync("app/settings.tsx", "utf8");
const scopuly = readFileSync("app/scopuly.tsx", "utf8");
const wallet = readFileSync("app/(tabs)/wallet.tsx", "utf8");

const screens = [
  "app/(tabs)/wallet.tsx",
  "app/(tabs)/dashboard.tsx",
  "app/send.tsx",
  "app/settings.tsx",
  "app/vault/[id].tsx",
  "app/scopuly.tsx",
  "app/key-manager.tsx",
];

describe("1.6.5 restores the 1.6.0 Aurora UI", () => {
  it("uses the Aurora colors from the last working build", () => {
    assert.match(theme, /background: "#0A0E17"/);
    assert.match(theme, /const ACCENT = "#5E9FFF"/);
    assert.match(theme, /textInverse: "#F5F7FA"/);
    assert.match(theme, /danger: "#E04545"/);
    assert.doesNotMatch(theme, /#05070d/);
    assert.doesNotMatch(theme, /#14b8a6/);
  });

  it("does not mount the site-teal header or the website logo", () => {
    assert.equal(existsSync("src/components/SiteChrome.tsx"), false);
    assert.equal(existsSync("assets/images/logo.png"), false);
    for (const file of screens) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /SiteChrome|SiteHeader|assets\/images\/logo\.png/);
    }
  });

  it("keeps splash and launcher backgrounds on the pre-teal color", () => {
    assert.match(colorsXml, /splashscreen_background">#060812</);
    assert.match(colorsXml, /iconBackground">#060812</);
    assert.match(appJson, /"backgroundColor": "#060812"/);
    assert.doesNotMatch(appJson, /#05070d/);
  });

  it("keeps Key Manager hooks above the access gate", () => {
    const source = readFileSync("app/key-manager.tsx", "utf8");
    const focus = source.indexOf("useFocusEffect(");
    const gate = source.indexOf("if (!accessChecked)");
    assert.ok(focus > 0 && gate > focus);
    assert.doesNotMatch(source, /if \(!accessChecked\) return null/);
  });

  it("still clears copied seeds, and Scopuly is an ordinary screen", () => {
    assert.match(settings, /copySecretToClipboard\(secret\)/);
    assert.match(settings, /key === "phrase" \|\| key === "seed"/);
    assert.match(scopuly, /testID="scopuly-back"/);
    assert.match(scopuly, /chevron-left/);
    assert.doesNotMatch(scopuly, /prepareScopulyRequest/);
  });

  it("keeps a compact Scopuly row and hides the removed 1.6.4 surfaces", () => {
    assert.match(wallet, /testID="wallet-scopuly-row"/);
    assert.match(wallet, /router\.push\("\/scopuly"\)/);
    assert.match(wallet, /Updating your wallet…/);
    assert.match(wallet, /testID="wallet-updating"/);
    assert.match(wallet, /colors\.textSecondary/);
    assert.doesNotMatch(wallet, /wallet-assistant-button/);
    assert.doesNotMatch(wallet, /ComingSoonSection/);
    assert.doesNotMatch(settings, /OTHER APPS BY THIS DEVELOPER/);
    assert.doesNotMatch(settings, /settings-assistant/);
    assert.doesNotMatch(settings, /settings-bills/);
    assert.doesNotMatch(settings, /ComingSoonSection/);
    const note = wallet.slice(wallet.indexOf("updatingNote:"), wallet.indexOf("scopulyRow:"));
    assert.match(note, /colors\.textSecondary/);
    assert.doesNotMatch(note, /colors\.danger/);
  });
});
