import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PERMANENT_ELITE_ACCOUNTS } from "../src/tiers/permanent-elite";
import {
  LOCK_MINIMUM_MESSAGE,
  LOCK_MINIMUM_STROOPS,
  XLM_LOCK_CREATE_KINDS,
  isNativeXlmSac,
  lockMinimumBlockReason,
  lockMinimumNotice,
  parseXlmToStroops,
  xlmLockCreateKindNeedsMinimum,
} from "../src/vault/lock-minimum";
import {
  MAINNET_DEPLOYMENT,
  TESTNET_DEPLOYMENT,
} from "../src/wallet/contract-config";

const OWNER = PERMANENT_ELITE_ACCOUNTS[PERMANENT_ELITE_ACCOUNTS.length - 1];
const OTHER = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

describe("10 XLM lock minimum", () => {
  it("requires at least 10 XLM and lets exactly 10 through", () => {
    assert.equal(parseXlmToStroops("10"), LOCK_MINIMUM_STROOPS);
    assert.equal(parseXlmToStroops("10.0000000"), LOCK_MINIMUM_STROOPS);
    assert.equal(parseXlmToStroops("9.9999999"), LOCK_MINIMUM_STROOPS - 1n);
    assert.equal(lockMinimumNotice("9.5", OTHER), LOCK_MINIMUM_MESSAGE);
    assert.equal(lockMinimumNotice("10", OTHER), null);
    assert.equal(lockMinimumNotice("10.0000001", OTHER), null);
    assert.equal(lockMinimumNotice("", OTHER), null);
    assert.equal(lockMinimumNotice("0", OTHER), null);
    assert.equal(lockMinimumBlockReason(1n, OTHER), LOCK_MINIMUM_MESSAGE);
    assert.equal(lockMinimumBlockReason(0n, OTHER), null);
    assert.equal(lockMinimumBlockReason(LOCK_MINIMUM_STROOPS, OTHER), null);
  });

  it("exempts every permanent Elite account and nobody else", () => {
    for (const account of PERMANENT_ELITE_ACCOUNTS) {
      assert.equal(lockMinimumNotice("0.1", account), null);
      assert.equal(lockMinimumNotice("0.1", `  ${account.toLowerCase()}  `), null);
      assert.equal(lockMinimumBlockReason(1n, `  ${account.toLowerCase()}  `), null);
    }
    assert.equal(lockMinimumNotice("1", OTHER), LOCK_MINIMUM_MESSAGE);
    assert.equal(lockMinimumNotice("1", null), LOCK_MINIMUM_MESSAGE);
    assert.equal(OWNER.length, 56);
  });

  it("skips the floor when the locked asset is not XLM", () => {
    assert.equal(isNativeXlmSac(MAINNET_DEPLOYMENT.nativeXlmSac), true);
    assert.equal(isNativeXlmSac(TESTNET_DEPLOYMENT.nativeXlmSac), true);
    assert.equal(isNativeXlmSac("C" + "A".repeat(55)), false);
    assert.equal(
      lockMinimumNotice("1", OTHER, { assetIsXlm: false }),
      null,
    );
    assert.equal(lockMinimumNotice("1", OTHER, { assetIsXlm: true }), LOCK_MINIMUM_MESSAGE);
  });

  it("covers timelocks, inheritance, cooling-off, vesting, dead man's switch, and Lock and earn", () => {
    for (const kind of [
      "TimeLock",
      "Inheritance",
      "CoolingOff",
      "Vesting",
      "DeadManSwitch",
      "LockAndEarn",
      "MultiSig",
      "HTLC",
    ]) {
      assert.equal(xlmLockCreateKindNeedsMinimum(kind), true);
    }
    assert.ok(XLM_LOCK_CREATE_KINDS.includes("Inheritance"));
    assert.ok(XLM_LOCK_CREATE_KINDS.includes("LockAndEarn"));
    assert.equal(xlmLockCreateKindNeedsMinimum("Send"), false);
  });

  it("does not apply the floor to send, receive, or a top-up deposit", () => {
    const send = readFileSync("app/send.tsx", "utf8");
    const receive = readFileSync("app/receive.tsx", "utf8");
    const client = readFileSync("src/api/soroban-client.ts", "utf8");
    for (const source of [send, receive]) {
      assert.doesNotMatch(source, /lock-minimum/);
      assert.doesNotMatch(source, /Locks need at least 10 XLM/);
    }
    const deposit = client.slice(
      client.indexOf("async deposit("),
      client.indexOf("async extendLock("),
    );
    assert.doesNotMatch(deposit, /lockMinimum/);
    const create = client.slice(
      client.indexOf("async createVault("),
      client.indexOf("async deposit("),
    );
    assert.match(create, /lockMinimumBlockReason/);
  });

  it("uses the same permanent Elite keys in the HTLC contract", () => {
    const rust = readFileSync("contracts/htlc/src/lib.rs", "utf8");
    for (const account of PERMANENT_ELITE_ACCOUNTS) {
      assert.match(rust, new RegExp(account));
    }
    assert.match(rust, /MIN_LOCK_STROOPS: i128 = 100_000_000/);
    assert.match(rust, /BelowMinimum = 13/);
    const claim = rust.slice(rust.indexOf("pub fn claim"), rust.indexOf("pub fn refund"));
    const refund = rust.slice(rust.indexOf("pub fn refund"), rust.indexOf("pub fn get_vault"));
    assert.doesNotMatch(claim, /MIN_LOCK_STROOPS|BelowMinimum|is_permanent_elite/);
    assert.doesNotMatch(refund, /MIN_LOCK_STROOPS|BelowMinimum|is_permanent_elite/);
  });
});
