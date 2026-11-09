import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { Keypair } from "@stellar/stellar-sdk";

import {
  canRetryFingerprint,
  checkSeedForWallet,
  fallbackMessage,
  fallbackReason,
  isStrandedWallet,
  seedShapeError,
  UNLOCK_FALLBACK_TIMEOUT_MS,
} from "../src/security/unlock-fallback.ts";

const derive = (s: string) => Keypair.fromSecret(s).publicKey();
const base = {
  ready: true,
  hasWallet: false,
  browseMode: false,
  activeId: "w1",
  activeEntryExists: true,
  hasSessionSeed: false,
  hasDerivedKey: false,
};

describe("1.6.17 unlock fallback", () => {
  it("a saved wallet with no seed in memory and no biometric key is stranded", () => {
    assert.equal(isStrandedWallet(base), true);
    assert.equal(isStrandedWallet({ ...base, hasDerivedKey: true }), false);
    assert.equal(isStrandedWallet({ ...base, hasSessionSeed: true }), false);
    assert.equal(isStrandedWallet({ ...base, hasWallet: true }), false);
    assert.equal(isStrandedWallet({ ...base, browseMode: true }), false);
    assert.equal(isStrandedWallet({ ...base, ready: false }), false);
    assert.equal(isStrandedWallet({ ...base, activeId: null }), false);
    assert.equal(isStrandedWallet({ ...base, activeEntryExists: false }), false);
  });

  it("no fingerprint on the phone offers the seed with no retry button", () => {
    for (const a of ["not_enrolled", "no_hardware"] as const) {
      const r = fallbackReason({ availability: a, stranded: true, attemptFailed: false, timedOut: false });
      assert.equal(r, "no_biometrics");
      assert.match(fallbackMessage(r) ?? "", /isn't set up/);
      assert.equal(canRetryFingerprint(a), false);
    }
  });

  it("a failed or slow fingerprint offers the seed and a retry", () => {
    assert.equal(
      fallbackReason({ availability: "available", stranded: false, attemptFailed: true, timedOut: false }),
      "biometric_failed",
    );
    assert.equal(
      fallbackReason({ availability: "available", stranded: true, attemptFailed: true, timedOut: false }),
      "needs_seed",
    );
    assert.equal(
      fallbackReason({ availability: "available", stranded: false, attemptFailed: false, timedOut: true }),
      "timeout",
    );
    assert.equal(
      fallbackReason({ availability: "available", stranded: false, attemptFailed: false, timedOut: false }),
      "none",
    );
    assert.equal(fallbackMessage("none"), null);
    assert.equal(canRetryFingerprint("available"), true);
    assert.ok(UNLOCK_FALLBACK_TIMEOUT_MS > 0 && UNLOCK_FALLBACK_TIMEOUT_MS <= 15000);
  });

  it("accepts only the seed that opens the active G address", () => {
    const wallet = Keypair.random();
    const other = Keypair.random();
    const ok = checkSeedForWallet(wallet.secret(), wallet.publicKey(), derive);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.seed, wallet.secret());
    const spaced = wallet.secret().toLowerCase().replace(/(.{8})/g, "$1 ");
    assert.equal(checkSeedForWallet(spaced, wallet.publicKey(), derive).ok, true);

    const wrong = checkSeedForWallet(other.secret(), wallet.publicKey(), derive);
    assert.deepEqual(wrong, { ok: false, error: "Seed does not match the active wallet. Check and try again." });
    const bad = checkSeedForWallet("S" + "A".repeat(55), wallet.publicKey(), derive);
    assert.equal(bad.ok, false);
    assert.equal(checkSeedForWallet("SHORT", wallet.publicKey(), derive).ok, false);
    assert.equal(checkSeedForWallet(wallet.publicKey(), wallet.publicKey(), derive).ok, false);
    assert.equal(checkSeedForWallet(wallet.secret(), null, derive).ok, false);
    assert.match(seedShapeError("") ?? "", /56-character/);
  });

  it("seed shape accepts a 12- or 24-word recovery phrase as well as an S-secret", () => {
    const phrase12 = Array(12).fill("alpha").join(" ");
    const phrase24 = Array(24).fill("bravo").join(" ");
    assert.equal(seedShapeError(phrase12), null);
    assert.equal(seedShapeError(phrase24), null);
    assert.equal(seedShapeError(phrase12.toUpperCase()), null);
    assert.notEqual(seedShapeError("alpha alpha"), null);
    const wallet = Keypair.random();
    assert.equal(seedShapeError(wallet.secret()), null);
    assert.match(seedShapeError("SHORT") ?? "", /recovery phrase/);
  });

  it("the helper never touches storage", () => {
    const src = readFileSync("src/security/unlock-fallback.ts", "utf8");
    assert.doesNotMatch(src, /^import /m);
    assert.doesNotMatch(src, /secureSet|setItem|SecureStore|AsyncStorage/);
  });

  it("wires the gate without renaming controls or adding storage", () => {
    const gate = readFileSync("src/security/BiometricGate.tsx", "utf8");
    const wallet = readFileSync("app/(tabs)/wallet.tsx", "utf8");
    assert.match(wallet, /<BiometricGate surface="wallet" offerSeedWhenStranded>\s*<SafeAreaView[^>]*testID="wallet-unlocking"/);
    assert.match(gate, /Unlock with biometrics/);
    assert.match(gate, /Use seed instead/);
    assert.match(gate, /Try fingerprint again/);
    assert.match(gate, /biometric-gate-seed-fallback-/);
    assert.match(gate, /biometric-gate-retry-/);
    assert.match(gate, /biometric-gate-fallback-message-/);
    assert.match(gate, /checkSeedForWallet\(\s*seedInput,\s*entry\.publicKey/);
    assert.match(gate, /keypairFromMnemonic\(phrase\)/);
    assert.match(gate, /warmSessionFromVerifiedSeed\(book\.activeId, checked\.seed\)/);
    assert.doesNotMatch(gate, /secureSet|storage\.setItem|SecureStore\./);
  });
});
