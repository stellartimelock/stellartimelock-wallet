import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const wallet = readFileSync("app/(tabs)/wallet.tsx", "utf8");
const gate = readFileSync("src/security/BiometricGate.tsx", "utf8");
const keystore = readFileSync("src/security/session-keystore.ts", "utf8");
const derived = readFileSync("src/security/derived-signing-key.ts", "utf8");
const backupCard = readFileSync("src/utils/manual-backup/ManualBackupCard.tsx", "utf8");
const backup = readFileSync("src/utils/manual-backup/manual-backup.ts", "utf8");
const settings = readFileSync("app/settings.tsx", "utf8");
const send = readFileSync("app/send.tsx", "utf8");
const tapSettings = readFileSync("src/tap-pay/TapPaySettings.tsx", "utf8");
const tapHome = readFileSync("app/tap-pay/index.tsx", "utf8");
const pay = readFileSync("app/tap-pay/pay.tsx", "utf8");
const assistant = readFileSync("app/assistant.tsx", "utf8");
const bills = readFileSync("app/bills.tsx", "utf8");
const elite = readFileSync("app/elite-tier.tsx", "utf8");
const dashboard = readFileSync("src/vault/TierMonitorDashboard.tsx", "utf8");
const book = readFileSync("src/wallet/wallet-book.ts", "utf8");

describe("wallet house pass 1.6.0", () => {
  it("restores a cold session from a biometric-cached derived key, not the S… seed", () => {
    assert.match(derived, /32-byte Ed25519 payload/);
    assert.match(derived, /The S… string is never written/);
    assert.match(keystore, /restoreSecretSeedFromDerivedKey/);
    assert.match(keystore, /persistDerivedSigningKey/);
    assert.match(gate, /hasDerivedSigningKey/);
    assert.match(gate, /Enter your seed once to enable fingerprint unlock/);
    assert.match(book, /warmSessionAfterBiometric/);
    assert.match(wallet, /wallet-unlocking/);
  });

  it("restores a chosen backup in one flow and lands on the wallet", () => {
    assert.match(backup, /pickManualBackupFile/);
    assert.match(backup, /restoreManualBackupPayload/);
    assert.match(backupCard, /pickManualBackupFile/);
    assert.match(backupCard, /Restore now/);
    assert.match(backupCard, /router\.replace\("\/\(tabs\)\/wallet"\)/);
  });

  it("keeps Request or pay on Send and drops the Home and Settings duplicates", () => {
    assert.match(send, /Request or pay/);
    assert.match(send, /wallet-tap-pay-button/);
    assert.match(send, /A tap alone never sends/);
    assert.doesNotMatch(wallet, /wallet-tap-pay-button/);
    assert.doesNotMatch(wallet, /wallet-assistant-button/);
    assert.doesNotMatch(tapSettings, /settings-tap-pay/);
    assert.doesNotMatch(tapSettings, /router\.push\("\/tap-pay"\)/);
    assert.match(tapHome, /Request or pay/);
    assert.match(pay, /tap-pay-send-confirm/);
    assert.match(pay, /A phone tap never sends/);
  });

  it("keeps the bills screen for old saves and hides it from Home and Settings", () => {
    assert.doesNotMatch(wallet, /wallet-bills-button/);
    assert.doesNotMatch(settings, /openFinanceBills/);
    assert.doesNotMatch(settings, /settings-bills/);
    assert.doesNotMatch(settings, /settings-assistant/);
    assert.match(bills, /Finance owns bills/);
    assert.match(bills, /bills-open-finance/);
    assert.match(bills, /Lock this amount in a vault/);
  });

  it("keeps Assistant copy calm and free of exchange brand names", () => {
    assert.match(assistant, /Type what you want/);
    assert.match(assistant, /Card deposit contact/);
    assert.doesNotMatch(assistant, /Coinbase/);
    assert.doesNotMatch(assistant, /coinbase card/i);
  });

  it("calms only the Elite dashboard chrome", () => {
    assert.match(elite, /Every vault type\. No limits\./);
    assert.match(dashboard, /arrange-toggle/);
    assert.match(dashboard, /WATCHED TOTAL/);
  });
});
