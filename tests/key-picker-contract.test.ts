import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const contract = readFileSync(
  "android/app/src/main/java/com/stellartimelock/keys/KeyPickerContract.kt",
  "utf8",
);
const guard = readFileSync(
  "android/app/src/main/java/com/stellartimelock/keys/KeyPickerGuard.kt",
  "utf8",
);
const activity = readFileSync(
  "android/app/src/main/java/com/stellartimelock/keys/KeyPickerActivity.kt",
  "utf8",
);
const service = readFileSync(
  "android/app/src/main/java/com/stellartimelock/keys/KeyPickerService.kt",
  "utf8",
);
const reader = readFileSync(
  "android/app/src/main/java/com/stellartimelock/keys/KeyManagerReader.kt",
  "utf8",
);
const gradle = readFileSync("android/app/build.gradle", "utf8");
const appVersion = readFileSync("constants/app-version.ts", "utf8");
const appJson = readFileSync("app.json", "utf8");
const providerDoc = readFileSync("docs/SEED_PROVIDER.md", "utf8");

describe("wallet key picker contract", () => {
  it("exports PICK_KEY behind a signature permission", () => {
    assert.match(manifest, /android:name="com\.stellartimelock\.wallet\.permission\.PICK_KEY"/);
    assert.match(manifest, /android:protectionLevel="signature"/);
    assert.match(manifest, /android:name="\.keys\.KeyPickerActivity"/);
    assert.match(manifest, /android:name="\.keys\.KeyPickerService"/);
    assert.match(manifest, /android:exported="true"/);
    assert.match(manifest, /com\.stellartimelock\.wallet\.action\.PICK_KEY/);
    assert.match(contract, /requestId/);
    assert.match(contract, /keyId/);
    assert.match(contract, /label/);
    assert.match(contract, /secret/);
  });

  it("allows any sibling signed with the same certificate", () => {
    assert.match(guard, /signerFingerprints/);
    assert.match(guard, /signed by the same/);
    assert.doesNotMatch(guard, /EXTERNAL_ALLOWLIST/);
    assert.doesNotMatch(guard, /stellarvault/);
    assert.doesNotMatch(guard, /stellaros/);
    assert.match(manifest, /android.intent.action.MAIN/);
    assert.match(manifest, /android.intent.category.LAUNCHER/);
  });

  it("confirms with the requesting app name and icon, then biometric only", () => {
    assert.match(contract, /wants your seed to open its save file/);
    assert.match(activity, /seedShareMessage/);
    assert.match(activity, /getApplicationIcon/);
    assert.match(activity, /getApplicationLabel/);
    assert.match(activity, /BIOMETRIC_STRONG/);
    assert.doesNotMatch(activity, /DEVICE_CREDENTIAL/);
    assert.doesNotMatch(activity, /createConfirmDeviceCredentialIntent/);
    assert.doesNotMatch(activity, /KeyguardManager/);
    assert.match(activity, /EXTRA_SECRET/);
    assert.match(service, /callerPackageForUid/);
  });

  it("does not log the seed", () => {
    for (const source of [activity, service, reader, guard, contract]) {
      assert.doesNotMatch(source, /android\.util\.Log/);
      assert.doesNotMatch(source, /\bLog\./);
      assert.doesNotMatch(source, /println/);
    }
  });

  it("keeps the Android applicationId on com.stellartimelock", () => {
    assert.match(gradle, /applicationId 'com\.stellartimelock'/);
    assert.doesNotMatch(gradle, /applicationId 'com\.stellartimelock\.wallet'/);
    assert.doesNotMatch(gradle, /applicationId 'com\.stellartimelock\.stellartimelock'/);
  });

  it("tracks the Android version and versionCode", () => {
    assert.match(gradle, /versionCode 29/);
    assert.match(gradle, /versionName "1\.6\.18"/);
    assert.match(appVersion, /APP_VERSION = "1\.6\.18"/);
    assert.match(appVersion, /BUILD_NUMBER = "29"/);
    assert.match(appJson, /"version": "1\.6\.18"/);
    assert.match(appJson, /"versionCode": 29/);
  });

  it("documents the intent, extras, result, and both snippets", () => {
    assert.match(providerDoc, /com\.stellartimelock\.wallet\.action\.PICK_KEY/);
    assert.match(providerDoc, /com\.stellartimelock\.wallet\.permission\.PICK_KEY/);
    assert.match(providerDoc, /requestId/);
    assert.match(providerDoc, /keyId/);
    assert.match(providerDoc, /label/);
    assert.match(providerDoc, /secret/);
    assert.match(providerDoc, /```kotlin/);
    assert.match(providerDoc, /react-native/);
    assert.match(providerDoc, /NativeModules/);
    assert.match(providerDoc, /wants your seed to open its save file/);
  });
});
