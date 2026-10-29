import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { loadLegacySeed } from "../src/security/legacy-seed-slot.ts";

const SEED = "S" + "A".repeat(55);

describe("legacy seed slot", () => {
  it("opted-in returns 0 seeds without a prompt", async () => {
    let plainReads = 0;
    let writes = 0;
    let deletes = 0;
    const seed = await loadLegacySeed({
      authFlag: true,
      readAuthenticated: async () => ({ promptSucceeded: false, value: null }),
      readPlain: async () => {
        plainReads += 1;
        return SEED;
      },
      writeAuthenticated: async () => {
        writes += 1;
        return true;
      },
      deletePlain: async () => {
        deletes += 1;
      },
    });
    const seeds = seed ? [seed] : [];
    assert.equal(seeds.length, 0);
    assert.equal(plainReads, 0);
    assert.equal(writes, 0);
    assert.equal(deletes, 0);
  });

  it("legacy is not downgraded", async () => {
    let plainReads = 0;
    let deleted = false;
    let writtenToAuth: string | null = null;
    const seed = await loadLegacySeed({
      authFlag: true,
      readAuthenticated: async () => ({ promptSucceeded: true, value: SEED }),
      readPlain: async () => {
        plainReads += 1;
        return SEED;
      },
      writeAuthenticated: async (value) => {
        writtenToAuth = value;
        return true;
      },
      deletePlain: async () => {
        deleted = true;
      },
    });
    assert.equal(seed, SEED);
    assert.equal(writtenToAuth, SEED);
    assert.equal(deleted, true);
    assert.equal(plainReads, 0);
    const source = readFileSync("src/security/legacy-seed-slot.ts", "utf8");
    assert.doesNotMatch(source, /secureSet\(/);
    assert.doesNotMatch(source, /removeItem|clearAuthFlag|authFlag = false/);
  });

  it("moves a plain copy into the auth slot after a successful prompt, then deletes it", async () => {
    const steps: string[] = [];
    const seed = await loadLegacySeed({
      authFlag: true,
      readAuthenticated: async () => ({ promptSucceeded: true, value: null }),
      readPlain: async () => {
        steps.push("read-plain");
        return SEED;
      },
      writeAuthenticated: async (value) => {
        steps.push(`write-auth:${value}`);
        return true;
      },
      deletePlain: async () => {
        steps.push("delete-plain");
      },
    });
    assert.equal(seed, SEED);
    assert.deepEqual(steps, ["read-plain", `write-auth:${SEED}`, "delete-plain"]);
  });

  it("leaves the plain copy in place when the auth write fails", async () => {
    let deleted = false;
    const seed = await loadLegacySeed({
      authFlag: true,
      readAuthenticated: async () => ({ promptSucceeded: true, value: null }),
      readPlain: async () => SEED,
      writeAuthenticated: async () => false,
      deletePlain: async () => {
        deleted = true;
      },
    });
    assert.equal(seed, null);
    assert.equal(deleted, false);
  });

  it("falls back to the plain slot only when the biometric flag is absent", async () => {
    let authReads = 0;
    const seed = await loadLegacySeed({
      authFlag: false,
      readAuthenticated: async () => {
        authReads += 1;
        return { promptSucceeded: false, value: null };
      },
      readPlain: async () => SEED,
      writeAuthenticated: async () => {
        throw new Error("plain fallback must not write");
      },
      deletePlain: async () => {
        throw new Error("plain fallback must not delete");
      },
    });
    assert.equal(seed, SEED);
    assert.equal(authReads, 0);
  });

  it("keeps the keystore, the audit excerpt, and backup encryption on the safe side of this bug", () => {
    const keystore = readFileSync("src/security/session-keystore.ts", "utf8");
    const getSeed = keystore.slice(
      keystore.indexOf("export async function getWalletSeed"),
      keystore.indexOf("export async function setWalletSeed"),
    );
    const setSeed = keystore.slice(
      keystore.indexOf("export async function setWalletSeed"),
      keystore.indexOf("export async function disableBiometricAuth"),
    );
    const warm = keystore.slice(
      keystore.indexOf("export async function warmSessionAfterBiometric"),
      keystore.indexOf("export function warmSessionFromVerifiedSeed"),
    );
    const lock = keystore.slice(
      keystore.indexOf("export function lockNow"),
      keystore.indexOf("export function isUnlocked"),
    );
    const audit = readFileSync("app/security-code.tsx", "utf8");
    const backup = readFileSync("src/security/backup-crypto.ts", "utf8");
    const settings = readFileSync("src/security/SecuritySection.tsx", "utf8");

    assert.match(getSeed, /if \(sessionLocked\) return null/);
    assert.doesNotMatch(getSeed, /secureGet/);
    assert.doesNotMatch(setSeed, /storage\.secureSet\(/);
    assert.match(setSeed, /retirePlainSeed/);
    assert.match(warm, /readLegacyWalletSeed/);
    assert.doesNotMatch(warm, /removeItem\(legacyAuthFlagKeyFor/);
    assert.doesNotMatch(warm, /storage\.secureSet\(/);
    assert.match(lock, /sessionCache\.clear\(\)/);
    assert.match(lock, /clearSessionRoot/);
    assert.match(lock, /dropCachedWrappingKey/);

    assert.doesNotMatch(audit, /migrate the seed BACK/);
    assert.doesNotMatch(audit, /default write path/);
    assert.match(audit, /if \(sessionLocked\) return null/);
    assert.match(audit, /retirePlainSeed/);

    assert.match(backup, /PBKDF2/);
    assert.doesNotMatch(backup, /requireAuthentication/);
    assert.doesNotMatch(backup, /legacy-seed-slot/);

    assert.match(settings, /Turn off fingerprint unlock\?/);
    assert.match(settings, /Backup files are not changed/);
    assert.match(settings, /Alert\.alert/);
  });
});
