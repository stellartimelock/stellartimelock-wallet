import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const apduXml = readFileSync("android/app/src/main/res/xml/tap_pay_apdu_service.xml", "utf8");
const apdu = readFileSync("android/app/src/main/java/com/stellartimelock/tap/TapPayApdu.kt", "utf8");
const module = readFileSync("android/app/src/main/java/com/stellartimelock/tap/TapPayModule.kt", "utf8");
const hce = readFileSync("android/app/src/main/java/com/stellartimelock/tap/TapPayHceService.kt", "utf8");
const entry = readFileSync("android/app/src/main/java/com/stellartimelock/tap/TapPayEntryActivity.kt", "utf8");
const sign = readFileSync("src/tap-pay/sign.ts", "utf8");
const pay = readFileSync("app/tap-pay/pay.tsx", "utf8");
const request = readFileSync("app/tap-pay/request.tsx", "utf8");
const doc = readFileSync("docs/TAP_TO_PAY.md", "utf8");

describe("tap-to-pay intent and NFC contract", () => {
  it("exposes REQUEST_PAY and PAY behind a signature permission", () => {
    assert.match(manifest, /android:name="com\.stellartimelock\.timelock\.permission\.TAP_PAY"/);
    assert.match(manifest, /android:protectionLevel="signature"/);
    assert.match(manifest, /android:name="\.tap\.TapPayRequestActivity"/);
    assert.match(manifest, /android:name="\.tap\.TapPayPayActivity"/);
    assert.match(entry, /abstract class TapPayEntryActivity/);
    assert.doesNotMatch(entry, /internal\s+abstract\s+class\s+TapPayEntryActivity/);
    assert.match(entry, /class TapPayRequestActivity : TapPayEntryActivity/);
    assert.match(entry, /class TapPayPayActivity : TapPayEntryActivity/);
    assert.match(manifest, /com\.stellartimelock\.timelock\.REQUEST_PAY/);
    assert.match(manifest, /com\.stellartimelock\.timelock\.PAY/);
    assert.match(doc, /com\.stellartimelock\.timelock\.REQUEST_PAY/);
    assert.match(doc, /com\.stellartimelock\.timelock\.PAY/);
    assert.match(doc, /Market/);
    assert.match(doc, /Delivery Driver/);
  });

  it("uses a proprietary AID in the non-payment host-card group", () => {
    assert.match(apduXml, /android:category="other"/);
    assert.match(apduXml, /F053544C50415901/);
    assert.doesNotMatch(apduXml, /android:category="payment"/);
    assert.doesNotMatch(apduXml, /apduServiceBanner/);
    assert.match(manifest, /android:name="\.tap\.TapPayHceService"/);
    assert.match(manifest, /android.permission.BIND_NFC_SERVICE/);
    assert.match(manifest, /android.hardware.nfc" android:required="false"/);
    assert.match(manifest, /android:scheme="web\+stellar"/);
    assert.match(apdu, /F053544C50415901/);
    assert.doesNotMatch(apdu, /CATEGORY_PAYMENT/);
    assert.doesNotMatch(module, /CATEGORY_PAYMENT/);
    assert.doesNotMatch(hce, /CATEGORY_PAYMENT/);
    assert.doesNotMatch(`${apdu}\n${module}\n${hce}`, /\bLog\./);
  });

  it("shows the amount and recipient before biometrics, then an in-app send confirm", () => {
    assert.match(pay, /tap-pay-amount/);
    assert.match(pay, /tap-pay-destination/);
    assert.match(pay, /tap-pay-send-confirm/);
    assert.match(pay, /tap-pay-send-now/);
    assert.match(pay, /signTapPaymentAfterBiometric/);
    assert.match(sign, /authenticate\(/);
    assert.match(sign, /loadSigningKeypair/);
    assert.match(sign, /confirmStillSafe/);
    assert.doesNotMatch(sign, /requireAuthentication/);
    assert.doesNotMatch(sign, /deriveKey/);
    assert.match(request, /QRCode/);
    assert.match(request, /request\?\.raw/);
  });
});
