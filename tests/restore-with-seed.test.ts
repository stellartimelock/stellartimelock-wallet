import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { checkSeedForWallet } from "../src/security/unlock-fallback.ts";
import { keypairFromMnemonic } from "../src/wallet/seed-phrase.ts";
import { accountFromRestoreInput } from "../src/wallet/restore-seed.ts";

const PHRASE = "illness spike retreat truth genius clock brain pass fit cave bargain toe";
const PRIMARY = "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";
const SECOND = "GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX";

describe("restore with seed", () => {
  it("derives the SEP-0005 primary account at m/44'/148'/0'", () => {
    const primary = keypairFromMnemonic(PHRASE, 0, "");
    const next = keypairFromMnemonic(PHRASE, 1, "");
    assert.equal(primary.publicKey, PRIMARY);
    assert.equal(next.publicKey, SECOND);
    assert.notEqual(primary.publicKey, next.publicKey);
    assert.equal(primary.secretSeed.startsWith("S"), true);
    assert.equal(primary.secretSeed.length, 56);

    const restored = accountFromRestoreInput(`  ${PHRASE.toUpperCase()}  `);
    assert.equal(restored.ok, true);
    if (restored.ok) {
      assert.equal(restored.account.kind, "phrase");
      assert.equal(restored.account.publicKey, PRIMARY);
      assert.equal(restored.account.secretSeed, primary.secretSeed);
    }
  });

  it("accepts a raw secret and rejects a bad phrase with a message that hides the words", () => {
    const phrase = keypairFromMnemonic(PHRASE);
    const fromSecret = accountFromRestoreInput(` ${phrase.secretSeed.toLowerCase()} `);
    assert.equal(fromSecret.ok, true);
    if (fromSecret.ok) {
      assert.equal(fromSecret.account.kind, "secret");
      assert.equal(fromSecret.account.publicKey, PRIMARY);
    }

    const bad = accountFromRestoreInput("illness spike retreat truth genius clock brain pass fit cave bargain zoo");
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.match(bad.error, /recovery phrase/);
      assert.doesNotMatch(bad.error, /illness/);
      assert.doesNotMatch(bad.error, /S[A-Z2-7]{20}/);
    }
    const empty = accountFromRestoreInput("   ");
    assert.equal(empty.ok, false);
  });

  it("matches a recovery phrase to the active wallet on the seed gate", () => {
    const checked = checkSeedForWallet(
      PHRASE,
      PRIMARY,
      () => {
        throw new Error("secret parser should not run");
      },
      (phrase) => keypairFromMnemonic(phrase),
    );
    assert.equal(checked.ok, true);
    if (checked.ok) assert.equal(checked.seed.startsWith("S"), true);

    const wrong = checkSeedForWallet(PHRASE, SECOND, () => "", (phrase) => keypairFromMnemonic(phrase));
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.match(wrong.error, /does not match/);
  });

  it("disconnect clears wallet state before restore can run", () => {
    const session = readFileSync("src/state/session.tsx", "utf8");
    const book = readFileSync("src/wallet/wallet-book.ts", "utf8");
    const keystore = readFileSync("src/security/session-keystore.ts", "utf8");
    const index = readFileSync("app/index.tsx", "utf8");
    const setup = readFileSync("app/wallet-setup.tsx", "utf8");
    const disconnect = session.slice(session.indexOf("const disconnect"), session.indexOf("const addBurnerWallet"));
    assert.match(disconnect, /clearBook/);
    assert.match(disconnect, /clearKeypair/);
    assert.match(disconnect, /clearKeyManagerSession/);
    assert.match(disconnect, /setWalletState\(null\)/);
    assert.match(disconnect, /setWallets\(\[\]\)/);
    assert.match(book, /releaseSessionAfterDisconnect/);
    assert.match(keystore, /removeWalletMnemonic/);
    assert.match(keystore, /sessionLocked = false/);
    assert.match(index, /useFocusEffect/);
    assert.doesNotMatch(index, /redirected/);
    assert.match(setup, /Restore with seed/);
    const importer = readFileSync("app/import.tsx", "utf8");
    assert.match(importer, /accountFromRestoreInput/);
    assert.match(importer, /import-seed-error/);
    assert.doesNotMatch(importer, /console\.warn\(\s*"\[Import\] wallet import failed"/);
    assert.doesNotMatch(importer, /console\.warn\([^)]*,\s*e\s*\)/);
  });
});
