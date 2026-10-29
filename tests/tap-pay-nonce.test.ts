import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { TESTNET_DEPLOYMENT } from "../src/wallet/contract-config.ts";
import { EXPIRY_SKEW_MS, REQUEST_TTL_MS } from "../src/tap-pay/constants.ts";
import { buildPayUri, createPayRequest, parsePayUri } from "../src/tap-pay/sep7.ts";
import {
  assessExpiry,
  assessReplay,
  nonceKey,
  rememberNonce,
} from "../src/tap-pay/replay.ts";
import { emptyTapPaySave, withPayment } from "../src/tap-pay/save.ts";

const NOW = 1_700_000_000_000;
const NONCE = "abcdef012345";

function uriAt(expiresAt: number) {
  const created = createPayRequest({
    destination: Keypair.random().publicKey(),
    amount: "2",
    memo: "",
    networkPassphrase: TESTNET_DEPLOYMENT.networkPassphrase,
    now: NOW,
    nonce: NONCE,
  });
  return buildPayUri({ ...created, expiresAt });
}

describe("payment nonce and expiry", () => {
  it("accepts a request inside two minutes and the small clock skew", () => {
    assert.equal(assessExpiry(NOW + REQUEST_TTL_MS, NOW), "ok");
    assert.equal(assessExpiry(NOW + REQUEST_TTL_MS + EXPIRY_SKEW_MS, NOW), "ok");
    assert.equal(assessExpiry(NOW + 1, NOW), "ok");
    const parsed = parsePayUri(uriAt(NOW + REQUEST_TTL_MS + EXPIRY_SKEW_MS), NOW);
    assert.equal(parsed.ok, true);
  });

  it("rejects an expired request and a request that lasts longer than two minutes", () => {
    assert.equal(assessExpiry(NOW, NOW), "expired");
    assert.equal(assessExpiry(NOW - 1, NOW), "expired");
    assert.equal(assessExpiry(NOW + REQUEST_TTL_MS + EXPIRY_SKEW_MS + 1, NOW), "expiry_window");
    const expired = parsePayUri(uriAt(NOW + REQUEST_TTL_MS), NOW + REQUEST_TTL_MS);
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.code, "expired");
    const tooLong = parsePayUri(uriAt(NOW + 10 * 60 * 1000), NOW);
    assert.equal(tooLong.ok, false);
    if (!tooLong.ok) assert.equal(tooLong.code, "expiry_window");
  });

  it("rejects a missing nonce and a nonce that does not match the memo", () => {
    const created = createPayRequest({
      destination: Keypair.random().publicKey(),
      amount: "2",
      networkPassphrase: TESTNET_DEPLOYMENT.networkPassphrase,
      now: NOW,
      nonce: NONCE,
    });
    const stripped = created.raw.replace(`nonce=${NONCE}`, "nonce=");
    const missing = parsePayUri(stripped, NOW);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "nonce");
    const swapped = created.raw.replace(`nonce=${NONCE}`, "nonce=1234567890ab");
    const mismatch = parsePayUri(swapped, NOW);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.code, "nonce");
  });

  it("treats a used nonce as a replay and a live pending nonce as in progress", () => {
    let seen = rememberNonce({}, nonceKey(NONCE), NOW + REQUEST_TTL_MS, "used");
    assert.equal(assessReplay(seen, nonceKey(NONCE), NOW), "replay");
    seen = rememberNonce({}, nonceKey(NONCE), NOW + REQUEST_TTL_MS, "pending");
    assert.equal(assessReplay(seen, nonceKey(NONCE), NOW), "pending");
    assert.equal(assessReplay(seen, nonceKey(NONCE), NOW + REQUEST_TTL_MS), "ok");
    assert.equal(assessReplay({}, nonceKey(NONCE), NOW), "ok");

    const doc = withPayment(emptyTapPaySave(NOW), {
      id: NONCE,
      role: "pay",
      network: "testnet",
      destination: Keypair.random().publicKey(),
      source: Keypair.random().publicKey(),
      amount: "1.0000000",
      memo: "",
      chainMemo: `n:${NONCE}:`,
      hash: "a".repeat(64),
      ledger: 1,
      createdAt: NOW,
      name: "",
    }, NOW);
    assert.equal(assessReplay(doc.nonces, nonceKey(NONCE), NOW + 1000), "replay");
  });
});
