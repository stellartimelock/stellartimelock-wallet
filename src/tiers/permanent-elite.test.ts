import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isStellarPublicKey } from "../wallet/strkey";
import {
  DEV_ELITE_WALLET_PUBLIC_KEY,
  PERMANENT_ELITE_ACCOUNTS,
  isPermanentEliteAccount,
  resolvePermanentEliteTier,
} from "./permanent-elite";

const OWNER_ACCOUNT =
  "GCTWHBAAXP44OF74KEOZU7QEJXJBASDMJ3UDJRGBEY35EMVHAE76RYNW";

const RESEARCHER_ACCOUNT =
  "GAJT5MLVAFGNEHEBCPKLV7UV4VGY2MUSPOKVVPNF2MVYLXJDBVKWC26G";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function corruptChecksum(address: string): string {
  const chars = address.split("");
  const index = BASE32.indexOf(chars[chars.length - 1]);
  chars[chars.length - 1] = BASE32[(index + 1) % BASE32.length];
  return chars.join("");
}

function dirOfThisFile(): string {
  return dirname(fileURLToPath(import.meta.url));
}

test("owner account is a checksum-valid Stellar G-address", () => {
  assert.equal(OWNER_ACCOUNT.length, 56);
  assert.equal(OWNER_ACCOUNT[0], "G");
  assert.equal(isStellarPublicKey(OWNER_ACCOUNT), true);
  assert.equal(isStellarPublicKey(corruptChecksum(OWNER_ACCOUNT)), false);
  assert.equal(isStellarPublicKey(OWNER_ACCOUNT.slice(0, -1) + "0"), false);
  assert.equal(isStellarPublicKey(`S${OWNER_ACCOUNT.slice(1)}`), false);
});

test("every permanent Elite account has a valid Stellar checksum", () => {
  assert.ok(PERMANENT_ELITE_ACCOUNTS.includes(OWNER_ACCOUNT));
  for (const account of PERMANENT_ELITE_ACCOUNTS) {
    assert.equal(isStellarPublicKey(account), true, account);
    assert.equal(isStellarPublicKey(corruptChecksum(account)), false, account);
  }
});

test("iblitzc0de is a checksum-valid lifetime Elite account", () => {
  assert.equal(RESEARCHER_ACCOUNT.length, 56);
  assert.equal(RESEARCHER_ACCOUNT[0], "G");
  assert.equal(isStellarPublicKey(RESEARCHER_ACCOUNT), true);
  assert.equal(isStellarPublicKey(corruptChecksum(RESEARCHER_ACCOUNT)), false);
  assert.equal(isStellarPublicKey(RESEARCHER_ACCOUNT.slice(0, -1) + "0"), false);
  assert.equal(isStellarPublicKey(`S${RESEARCHER_ACCOUNT.slice(1)}`), false);
  assert.ok(PERMANENT_ELITE_ACCOUNTS.includes(RESEARCHER_ACCOUNT));
  assert.notEqual(RESEARCHER_ACCOUNT, DEV_ELITE_WALLET_PUBLIC_KEY);
  assert.notEqual(RESEARCHER_ACCOUNT, OWNER_ACCOUNT);
  assert.equal(isPermanentEliteAccount(RESEARCHER_ACCOUNT), true);
  assert.equal(
    isPermanentEliteAccount(`  ${RESEARCHER_ACCOUNT.toLowerCase()}  `),
    true,
  );
  for (const tier of ["free", "plus", "pro", "elite"] as const) {
    assert.equal(resolvePermanentEliteTier(tier, RESEARCHER_ACCOUNT), "elite");
  }
  const source = readFileSync(join(dirOfThisFile(), "permanent-elite.ts"), "utf8");
  assert.match(
    source,
    /\/\/ iblitzc0de, security researcher, lifetime Elite \(2026-10-11\)\n {2}"GAJT5MLVAFGNEHEBCPKLV7UV4VGY2MUSPOKVVPNF2MVYLXJDBVKWC26G"/,
  );
});

test("owner account resolves to Elite and cannot be downgraded", () => {
  assert.notEqual(OWNER_ACCOUNT, DEV_ELITE_WALLET_PUBLIC_KEY);
  assert.equal(isPermanentEliteAccount(OWNER_ACCOUNT), true);
  assert.equal(isPermanentEliteAccount(`  ${OWNER_ACCOUNT.toLowerCase()}  `), true);
  for (const tier of ["free", "plus", "pro", "elite"] as const) {
    assert.equal(resolvePermanentEliteTier(tier, OWNER_ACCOUNT), "elite");
  }
  assert.equal(
    resolvePermanentEliteTier("free", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    "free",
  );
  assert.equal(resolvePermanentEliteTier("pro", null), "pro");
  assert.equal(isPermanentEliteAccount(null), false);
  assert.equal(isPermanentEliteAccount(""), false);
});

test("tier modules share one permanent Elite list", () => {
  const dir = dirOfThisFile();
  const subscriptionStore = readFileSync(join(dir, "subscription-store.ts"), "utf8");
  const tierConfig = readFileSync(join(dir, "tier-config.ts"), "utf8");
  assert.match(subscriptionStore, /isPermanentEliteAccount\(publicKey\)/);
  assert.match(tierConfig, /isPermanentEliteAccount\(pk\)/);
  assert.match(tierConfig, /resolvePermanentEliteTier/);
  assert.doesNotMatch(subscriptionStore, /G[A-Z2-7]{55}/);
  assert.doesNotMatch(tierConfig, /G[A-Z2-7]{55}/);
});
