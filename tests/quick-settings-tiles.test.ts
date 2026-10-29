import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const tiles = readFileSync(
  "android/app/src/main/java/com/stellartimelock/tiles/QuickSettingsTiles.kt",
  "utf8",
);
const strings = readFileSync("android/app/src/main/res/values/strings.xml", "utf8");
const send = readFileSync("app/send.tsx", "utf8");
const wallet = readFileSync("app/(tabs)/wallet.tsx", "utf8");
const gate = readFileSync("src/security/BiometricGate.tsx", "utf8");
const gradle = readFileSync("android/app/build.gradle", "utf8");

describe("quick settings tiles", () => {
  it("publishes Receive XLM, Send XLM, and Balance", () => {
    for (const name of ["ReceiveTileService", "SendTileService", "BalanceTileService"]) {
      assert.match(manifest, new RegExp(`android:name="\\.tiles\\.${name}"`));
    }
    assert.match(manifest, /android.permission.BIND_QUICK_SETTINGS_TILE/);
    assert.match(manifest, /android.service.quicksettings.action.QS_TILE/);
    assert.match(strings, /name="qs_receive_xlm">Receive XLM</);
    assert.match(strings, /name="qs_send_xlm">Send XLM</);
    assert.match(strings, /name="qs_balance">Balance</);
    assert.match(gradle, /versionCode 30/);
    assert.match(gradle, /versionName "1\.6\.19"/);
  });

  it("opens the existing receive QR, send favorites, and balance after biometric", () => {
    assert.match(tiles, /stellartimelock:\/\/receive/);
    assert.match(tiles, /stellartimelock:\/\/send\?favorites=1/);
    assert.match(tiles, /stellartimelock:\/\/wallet\?tile=balance/);
    assert.match(send, /favorites/);
    assert.match(send, /openFavorites/);
    assert.match(wallet, /requireUnlock=\{balanceTile\}/);
    assert.match(gate, /requireUnlock/);
    assert.match(gate, /bioAuthenticate/);
    assert.doesNotMatch(tiles, /secretSeed/);
    assert.doesNotMatch(tiles, /\bLog\./);
  });
});
