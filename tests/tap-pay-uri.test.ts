import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { TESTNET_DEPLOYMENT } from "../src/wallet/contract-config.ts";
import { NOTE_ON_CHAIN_BYTES } from "../src/tap-pay/constants.ts";
import { utf8Length } from "../src/tap-pay/money.ts";
import {
  buildChainMemo,
  buildPayUri,
  createPayRequest,
  parsePayUri,
} from "../src/tap-pay/sep7.ts";

const NOW = 1_700_000_000_000;
const DESTINATION = Keypair.random().publicKey();
const NONCE = "abcdef012345";

function sample(memo = "coffee") {
  return createPayRequest({
    destination: DESTINATION,
    amount: "1.5",
    memo,
    networkPassphrase: TESTNET_DEPLOYMENT.networkPassphrase,
    now: NOW,
    nonce: NONCE,
  });
}

describe("SEP-7 pay URI", () => {
  it("round-trips the QR payload and the deep link as one string", () => {
    const created = sample();
    assert.equal(created.raw, buildPayUri(created));
    assert.match(created.raw, /^web\+stellar:pay\?/);
    const parsed = parsePayUri(created.raw, NOW);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.request.destination, DESTINATION);
    assert.equal(parsed.request.amount, "1.5000000");
    assert.equal(parsed.request.memo, "coffee");
    assert.equal(parsed.request.nonce, NONCE);
    assert.equal(parsed.request.chainMemo, created.chainMemo);
    assert.equal(parsed.request.expiresAt, NOW + 120_000);
    assert.equal(parsed.request.networkPassphrase, TESTNET_DEPLOYMENT.networkPassphrase);
    assert.equal(parsePayUri(`web+stellar://${created.raw.slice("web+stellar:".length)}`, NOW).ok, true);
  });

  it("keeps the on-chain memo inside 28 bytes, including a long note", () => {
    const note = `${"😀".repeat(8)}thanks for the delivery`;
    const memo = buildChainMemo(NONCE, note);
    assert.ok(utf8Length(memo) <= 28);
    assert.ok(memo.startsWith(`n:${NONCE}:`));
    assert.equal(NOTE_ON_CHAIN_BYTES, 13);
    const created = sample(note);
    const parsed = parsePayUri(created.raw, NOW);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.request.memo, note.trim());
    assert.equal(utf8Length(parsed.request.chainMemo), utf8Length(memo));
  });

  it("rejects a tampered note, a non-XLM asset, and a non-pay link", () => {
    const created = sample();
    const tampered = created.raw.replace("msg=coffee", "msg=rent");
    const badNote = parsePayUri(tampered, NOW);
    assert.equal(badNote.ok, false);
    if (!badNote.ok) assert.equal(badNote.code, "memo");

    const asset = parsePayUri(`${created.raw}&asset_code=USDC&asset_issuer=${DESTINATION}`, NOW);
    assert.equal(asset.ok, false);
    if (!asset.ok) assert.equal(asset.code, "asset");

    const xlm = parsePayUri(`${created.raw}&asset_code=XLM`, NOW);
    assert.equal(xlm.ok, true);

    const other = parsePayUri("web+stellar:tx?xdr=AAAA", NOW);
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.code, "not_pay");
  });

  it("ignores a callback URL instead of contacting it", () => {
    const created = sample();
    const withCallback = `${created.raw}&callback=${encodeURIComponent("https://evil.example/hook")}`;
    const parsed = parsePayUri(withCallback, NOW);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal("callback" in parsed.request, false);
    assert.equal(parsed.request.destination, DESTINATION);
  });
});
