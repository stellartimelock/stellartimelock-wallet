import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (p: string) => readFileSync(p, "utf8");
const gradle = read("android/app/build.gradle");
const playNetwork = read("src/wallet/play-network.ts");
const session = read("src/state/session.tsx");
const envelope = read("src/utils/backup-envelope.ts");
const card = read("src/utils/manual-backup/ManualBackupCard.tsx");
const importScreen = read("app/import.tsx");
const settings = read("app/settings.tsx");
const disclosures = read("app/legal/disclosures.tsx");

describe("testnet verification build", () => {
  it("is switched on only by EXPO_PUBLIC_STL_VERIFY_TESTNET=1", () => {
    assert.match(playNetwork, /process\.env\.EXPO_PUBLIC_STL_VERIFY_TESTNET === "1"/);
    assert.match(gradle, /System\.getenv\('EXPO_PUBLIC_STL_VERIFY_TESTNET'\) \?: ''\) == '1'/);
    assert.doesNotMatch(read(".env.example"), /STL_VERIFY_TESTNET/);
  });

  it("uses its own applicationId, the house debug key and fdroid only", () => {
    assert.match(gradle, /if \(stlVerifyTestnet\) \{\s*applicationIdSuffix "\.verify"\s*versionNameSuffix "-verifytestnet"/);
    assert.match(gradle, /signingConfig stlVerifyTestnet \? signingConfigs\.debug : signingConfigs\.release/);
    assert.match(gradle, /builds only assembleFdroidRelease/);
    assert.match(gradle, /applicationId 'com\.stellartimelock'/);
    const label = read("android/app/src/verifytestnet/res/values/strings.xml");
    assert.match(label, /<string name="app_name">STL TESTNET verify<\/string>/);
    assert.match(read("android/app/src/main/res/values/strings.xml"), /<string name="app_name">Stellar TimeLock<\/string>/);
    const overlay = read("android/app/src/verifytestnet/AndroidManifest.xml");
    for (const p of ["com.stellartimelock.wallet.permission.PICK_KEY", "com.stellartimelock.timelock.permission.TAP_PAY"]) {
      assert.ok(overlay.includes(`<permission android:name="${p}" tools:node="remove"/>`), p);
      assert.ok(overlay.includes(`<uses-permission android:name="${p}" tools:node="remove"/>`), p);
    }
    assert.match(gradle, /manifest\.srcFile 'src\/verifytestnet\/AndroidManifest\.xml'/);
  });

  it("starts on testnet only in the verify build; release stays mainnet", () => {
    assert.match(session, /const candidate: StellarNetwork = isVerifyTestnetBuild\(\) \? "testnet" : "mainnet";/);
    assert.match(session, /if \(isVerifyTestnetBuild\(\)\) \{\s*if \(n !== "testnet"\) return;\s*\} else if \(isPlayReleaseBuild\(\) && n !== "mainnet"\) \{\s*return;/);
  });

  it("shows a TESTNET banner only in the verify build", () => {
    const banner = read("src/components/VerifyTestnetBanner.tsx");
    assert.match(banner, /if \(!isVerifyTestnetBuild\(\)\) return null;/);
    assert.match(banner, /TESTNET VERIFY BUILD/);
    assert.match(banner, /pointerEvents="none"/);
    assert.match(read("app/_layout.tsx"), /<VerifyTestnetBanner \/>/);
  });
});

describe("backup carries the display currency (1.6.20)", () => {
  it("writes prefs.currency and keeps envelope v8 so older apps still import", () => {
    assert.ok(existsSync("src/state/currency-pref.ts"));
    assert.match(envelope, /const currency = await readDisplayCurrency\(\);/);
    assert.match(envelope, /\.\.\.\(currency \? \{ prefs: \{ currency \} \} : \{\}\)/);
    assert.match(envelope, /v: 8,\n\s*writtenAt/);
  });

  it("restores it when present and leaves it alone for older files", () => {
    assert.match(envelope, /const currency = isDisplayCurrency\(prefCurrency\) \? prefCurrency : undefined;/);
    assert.match(card, /if \(r\.applied\.currency\) await setCurrency\(r\.applied\.currency\)/);
    assert.match(importScreen, /if \(r\.applied\.currency\) await setCurrency\(r\.applied\.currency\)/);
    assert.match(session, /import \{ CURRENCY_KEY \} from "@\/src\/state\/currency-pref";/);
    assert.match(read("src/state/currency-pref.ts"), /export const CURRENCY_KEY = "xlm_vault_currency";/);
  });
});

describe("small fixes from the recovery check", () => {
  it("says the wallet is locked instead of not loaded", () => {
    assert.doesNotMatch(card, /toast\.show\("No wallet loaded"/);
    assert.match(card, /Your wallet is locked\. Unlock it, then try again\./);
    assert.equal((card.match(/toast\.show\(noSeedMessage\(wallet\), "error"\)/g) ?? []).length, 4);
  });

  it("names the source page without an audit claim", () => {
    assert.doesNotMatch(settings, /Audit Our Security Code/);
    assert.match(settings, /label="View Source Code"/);
    assert.doesNotMatch(disclosures, /Audit Our Security Code|for security audit/);
  });
});
