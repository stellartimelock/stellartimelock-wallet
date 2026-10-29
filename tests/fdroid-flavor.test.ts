import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appGradle = readFileSync("android/app/build.gradle", "utf8");
const rootGradle = readFileSync("android/build.gradle", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const pair = readFileSync("app/key-manager-pair.tsx", "utf8");
const mainApp = readFileSync("android/app/src/main/java/com/stellartimelock/MainApplication.kt", "utf8");
const fdroidDir = "android/app/src/fdroid/java/com/stellartimelock/flavor";

describe("F-Droid flavor", () => {
  it("defines play and fdroid flavors on one store dimension, same applicationId", () => {
    assert.match(appGradle, /flavorDimensions "store"/);
    assert.match(appGradle, /play \{\s*dimension "store"\s*\}/);
    assert.match(appGradle, /fdroid \{\s*dimension "store"/);
    assert.doesNotMatch(appGradle, /applicationIdSuffix/);
    assert.match(appGradle, /applicationId 'com\.stellartimelock'/);
  });

  it("excludes every proprietary library group from fdroid configurations", () => {
    for (const g of [
      "com.google.firebase",
      "com.google.android.gms",
      "com.google.android.datatransport",
      "com.google.mlkit",
      "com.google.android.odml",
      "com.android.installreferrer",
    ]) {
      assert.ok(appGradle.includes(`c.exclude group: "${g}"`), g);
    }
    assert.match(appGradle, /c\.name\.startsWith\("fdroid"\)/);
  });

  it("uses ZXing only in the fdroid flavor", () => {
    assert.match(appGradle, /fdroidImplementation\("com\.journeyapps:zxing-android-embedded:4\.3\.0"\)/);
    assert.ok(existsSync(`${fdroidDir}/FossQrScannerModule.kt`));
    const mod = readFileSync(`${fdroidDir}/FossQrScannerModule.kt`, "utf8");
    assert.match(mod, /"FossQrScanner"/);
    assert.doesNotMatch(mod, /Log\.|println/);
    const playPk = readFileSync("android/app/src/play/java/com/stellartimelock/flavor/FlavorPackages.kt", "utf8");
    assert.match(playPk, /emptyList\(\)/);
    assert.match(mainApp, /addAll\(FlavorPackages\.get\(\)\)/);
  });

  it("pairing screen uses the FOSS scanner when present and never mounts the ML Kit camera scanner then", () => {
    assert.match(pair, /hasFossQrScanner \? startFossScan : startScan/);
    assert.match(pair, /!scanned && !hasFossQrScanner \?/);
    assert.match(pair, /parseQrUri\(data\)/);
  });

  it("has no JitPack repository and no JitPack-only dependency", () => {
    assert.doesNotMatch(rootGradle, /jitpack/i);
    assert.ok(!("expo-blur" in pkg.dependencies), "expo-blur pulls BlurView from JitPack");
    const patch = readFileSync("patches/@react-native-masked-view+masked-view+0.3.2.patch", "utf8");
    assert.match(patch, /^-\s+maven \{ url "https:\/\/jitpack\.io" \}/m);
  });
});
