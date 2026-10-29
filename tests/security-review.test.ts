import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import {
  publishSessionLock,
  resetSessionLockForTests,
} from "../src/security/session-lock.ts";
import {
  copySecretToClipboard,
  resetSecretClipboardForTests,
  SECRET_CLIPBOARD_CLEAR_MS,
} from "../src/security/clipboard-secret.ts";
import { downloadAndInstallApk } from "../src/updates/install-apk.ts";
import { isHttpsRpcUrl } from "../src/wallet/rpc-url.ts";
import {
  keypairIfUnlocked,
  SessionLockedError,
} from "../src/wallet/sign-lock.ts";
import {
  assertSorobanFeeWithinCap,
  MAX_SOROBAN_FEE_STROOPS,
} from "../src/wallet/soroban-fee-cap.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

describe("security review gates", () => {
  it("caps a Soroban fee at 10 XLM", () => {
    assert.equal(MAX_SOROBAN_FEE_STROOPS, 100_000_000n);
    assert.doesNotThrow(() => assertSorobanFeeWithinCap("100"));
    assert.doesNotThrow(() =>
      assertSorobanFeeWithinCap(MAX_SOROBAN_FEE_STROOPS.toString()),
    );
    assert.throws(
      () => assertSorobanFeeWithinCap((MAX_SOROBAN_FEE_STROOPS + 1n).toString()),
      /10 XLM cap/,
    );
    assert.throws(() => assertSorobanFeeWithinCap("1.5"), /stroop count/);
    assert.throws(() => assertSorobanFeeWithinCap("-1"), /stroop count/);
    assert.throws(() => assertSorobanFeeWithinCap(""), /stroop count/);
  });

  it("accepts only https RPC URLs with no password", () => {
    assert.equal(isHttpsRpcUrl("https://rpc.ankr.com/stellar_soroban"), true);
    assert.equal(isHttpsRpcUrl("  https://example.com/rpc  "), true);
    assert.equal(isHttpsRpcUrl("http://127.0.0.1:8000"), false);
    assert.equal(isHttpsRpcUrl("https://user:pass@rpc.example/path"), false);
    assert.equal(isHttpsRpcUrl("https://user@rpc.example"), false);
    assert.equal(isHttpsRpcUrl("ftp://rpc.example"), false);
    assert.equal(isHttpsRpcUrl("not a url"), false);
    assert.equal(isHttpsRpcUrl(""), false);
  });

  it("refuses to build a keypair while the session is locked", () => {
    resetSessionLockForTests();
    const secret = Keypair.random().secret();
    assert.throws(() => keypairIfUnlocked(secret), SessionLockedError);
    publishSessionLock(true, true);
    assert.throws(() => keypairIfUnlocked(secret), /fingerprint/);
    publishSessionLock(false, false);
    assert.throws(() => keypairIfUnlocked(secret), SessionLockedError);
    publishSessionLock(false, true);
    assert.equal(keypairIfUnlocked(secret).secret(), secret);
    resetSessionLockForTests();
  });

  it("clears a copied secret from the clipboard", async () => {
    resetSecretClipboardForTests();
    const writes: string[] = [];
    let fire: (() => void) | null = null;
    await copySecretToClipboard("SSECRET", {
      setString: async (value) => {
        writes.push(value);
      },
      schedule: (fn) => {
        fire = fn;
        return { clear: () => { fire = null; } };
      },
      clearAfterMs: SECRET_CLIPBOARD_CLEAR_MS,
    });
    assert.deepEqual(writes, ["SSECRET"]);
    assert.equal(typeof fire, "function");
    fire!();
    assert.deepEqual(writes, ["SSECRET", ""]);
    resetSecretClipboardForTests();
  });

  it("does not install APKs from inside the app", async () => {
    await assert.rejects(
      () => downloadAndInstallApk("https://example.com/app.apk"),
      /Google Play/,
    );
  });

  it("keeps signing, lock, and Play-permission fixes in source", () => {
    const keystore = readFileSync("src/security/session-keystore.ts", "utf8");
    const layout = readFileSync("app/_layout.tsx", "utf8");
    const session = readFileSync("src/state/session.tsx", "utf8");
    const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    const appJson = readFileSync("app.json", "utf8");
    const card = readFileSync("src/updates/UpdateAvailableCard.tsx", "utf8");
    const feeCap = readFileSync("src/wallet/soroban-fee-cap.ts", "utf8");

    assert.match(keystore, /if \(sessionLocked\) return null/);
    assert.match(keystore, /secureSetAuthenticated/);
    assert.match(keystore, /function authMnemonicKey/);
    assert.match(keystore, /\$\{MNEMONIC_PREFIX\}auth_/);
    assert.match(layout, /<BiometricGate surface="wallet">/);
    assert.match(session, /secretSeed: ""/);
    assert.doesNotMatch(manifest, /REQUEST_INSTALL_PACKAGES/);
    assert.doesNotMatch(manifest, /SYSTEM_ALERT_WINDOW/);
    assert.match(manifest, /com\.google\.android\.c2dm\.permission\.RECEIVE" tools:node="remove"/);
    assert.match(
      manifest,
      /BIND_GET_INSTALL_REFERRER_SERVICE" tools:node="remove"/,
    );
    assert.match(manifest, /com\.sec\.android\.provider\.badge\.permission\.READ" tools:node="remove"/);
    assert.match(manifest, /FirebaseInstanceIdReceiver" tools:node="remove"/);
    assert.doesNotMatch(manifest, /android\.permission\.CAMERA" tools:node="remove"/);
    assert.doesNotMatch(manifest, /POST_NOTIFICATIONS" tools:node="remove"/);
    assert.doesNotMatch(manifest, /RECEIVE_BOOT_COMPLETED" tools:node="remove"/);
    assert.match(readFileSync("app/key-manager-pair.tsx", "utf8"), /CameraView/);
    assert.match(readFileSync("src/notifications/index.ts", "utf8"), /scheduleNotificationAsync/);
    assert.doesNotMatch(readFileSync("src/notifications/index.ts", "utf8"), /getExpoPushToken|getDevicePushToken/);
    assert.match(manifest, /android:allowBackup="false"/);
    assert.doesNotMatch(appJson, /REQUEST_INSTALL_PACKAGES/);
    assert.doesNotMatch(card, /Download and install/);
    assert.match(card, /Google Play/);
    assert.match(feeCap, /assembleTransaction/);

    const offenders: string[] = [];
    for (const file of [...walk("src"), ...walk("app")]) {
      if (file.endsWith("src/wallet/sign-lock.ts")) continue;
      if (file.endsWith("src/wallet/soroban-fee-cap.ts")) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes("Keypair.fromSecret")) offenders.push(file);
      if (text.includes("assembleTransaction(")) offenders.push(file);
    }
    assert.deepEqual(offenders, []);
  });
});
