import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

import { publishSessionLock, resetSessionLockForTests } from "../src/security/session-lock.ts";
import { TESTNET_DEPLOYMENT } from "../src/wallet/contract-config.ts";
import { assertHttps443 } from "../src/tap-pay/horizon-pay.ts";
import { buildSignedPayment } from "../src/tap-pay/tx.ts";

describe("tap-to-pay transaction building", () => {
  it("signs a native payment bound to the testnet passphrase", () => {
    publishSessionLock(false, true);
    assert.equal(Networks.TESTNET, TESTNET_DEPLOYMENT.networkPassphrase);
    const source = Keypair.random();
    const destination = Keypair.random().publicKey();
    const memo = "n:abcdef012345:coffee";
    const built = buildSignedPayment({
      sourceSecret: source.secret(),
      sequence: "100",
      destination,
      amount: "1.25",
      memo,
      networkPassphrase: Networks.TESTNET,
    });
    assert.equal(built.source, source.publicKey());

    const tx = TransactionBuilder.fromXDR(built.xdr, Networks.TESTNET);
    assert.equal(tx.networkPassphrase, Networks.TESTNET);
    const operation = tx.operations[0];
    assert.equal(operation.type, "payment");
    if (operation.type !== "payment") return;
    assert.equal(operation.destination, destination);
    assert.equal(operation.amount, "1.2500000");
    assert.equal(operation.asset.isNative(), true);
    const memoValue = typeof tx.memo.value === "string"
      ? tx.memo.value
      : Buffer.from(tx.memo.value ?? []).toString("utf8");
    assert.equal(memoValue, memo);
    assert.equal(source.verify(tx.hash(), tx.signatures[0].signature()), true);

    const mainnet = TransactionBuilder.fromXDR(built.xdr, Networks.PUBLIC);
    assert.equal(source.verify(mainnet.hash(), mainnet.signatures[0].signature()), false);
    resetSessionLockForTests();
  });

  it("refuses to sign while the session is locked", () => {
    publishSessionLock(true, true);
    assert.throws(() => buildSignedPayment({
      sourceSecret: Keypair.random().secret(),
      sequence: "1",
      destination: Keypair.random().publicKey(),
      amount: "1",
      memo: "n:abcdef012345:hi",
      networkPassphrase: Networks.TESTNET,
    }), /fingerprint/);
    resetSessionLockForTests();
  });

  it("refuses a memo that does not fit in MEMO_TEXT", () => {
    publishSessionLock(false, true);
    assert.throws(() => buildSignedPayment({
      sourceSecret: Keypair.random().secret(),
      sequence: "1",
      destination: Keypair.random().publicKey(),
      amount: "1",
      memo: "x".repeat(29),
      networkPassphrase: Networks.TESTNET,
    }), /28 bytes/);
    resetSessionLockForTests();
  });

  it("only talks to Horizon over HTTPS port 443", () => {
    assert.equal(assertHttps443("https://horizon-testnet.stellar.org"), "https://horizon-testnet.stellar.org");
    assert.equal(assertHttps443("https://horizon.stellar.org/"), "https://horizon.stellar.org");
    assert.equal(assertHttps443("https://horizon-testnet.stellar.org:443"), "https://horizon-testnet.stellar.org");
    assert.throws(() => assertHttps443("http://horizon-testnet.stellar.org"), /HTTPS/);
    assert.throws(() => assertHttps443("https://horizon-testnet.stellar.org:8000"), /443/);
    assert.equal(TESTNET_DEPLOYMENT.horizonUrl.startsWith("https://"), true);
    assert.equal(new URL(TESTNET_DEPLOYMENT.horizonUrl).port, "");
  });
});
