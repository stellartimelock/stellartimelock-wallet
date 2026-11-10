import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  Account,
  Asset,
  Claimant,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { constantTimeEqual } from "../src/scopuly/constant-time.ts";
import {
  SCOPULY_ANDROID_PACKAGE,
  SCOPULY_FEATURES,
  SCOPULY_PLAY_MARKET,
  SCOPULY_PLAY_URL,
  SCOPULY_X_URL,
} from "../src/scopuly/features.ts";
import { scopulyLaunchIntentUri } from "../src/scopuly/launch-intent.ts";
import {
  SCOPULY_SEP7_HANDOFF_ENABLED,
  VAULT_WITHDRAW_REQUIRES_SCOPULY,
} from "../src/scopuly/flags.ts";
import { prepareScopulyRequest, type VaultHandoffConfirm } from "../src/scopuly/handoff.ts";
import { buildWebStellarTxUri } from "../src/scopuly/sep7-tx.ts";
import { verifySignedReturn } from "../src/scopuly/verify-return.ts";
import { encodeEd25519SecretSeed } from "../src/wallet/strkey.ts";

const SECRET = encodeEd25519SecretSeed(new Uint8Array(32).fill(9));
const SOURCE = Keypair.random();
const RECIPIENT = Keypair.random();

function payment(opts: { timeout: number; ops?: number; source?: Keypair }) {
  const source = opts.source ?? SOURCE;
  const account = new Account(source.publicKey(), "100");
  const builder = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  for (let i = 0; i < (opts.ops ?? 1); i++) {
    builder.addOperation(
      Operation.payment({
        destination: RECIPIENT.publicKey(),
        asset: Asset.native(),
        amount: "1.0000000",
      }),
    );
  }
  builder.setTimeout(opts.timeout);
  const tx = builder.build();
  const unsigned = tx.toXDR();
  return { unsigned, tx, source, now: Math.floor(Date.now() / 1000) };
}

const UNLOCK_UNIX = String(Math.floor(Date.UTC(2027, 0, 1, 15, 0, 0) / 1000));

function claimable(opts?: {
  amount?: string;
  dest?: string;
  unlock?: string;
  timeout?: number;
  claimants?: Claimant[];
}) {
  const dest = opts?.dest ?? RECIPIENT.publicKey();
  const unlock = opts?.unlock ?? UNLOCK_UNIX;
  const account = new Account(SOURCE.publicKey(), "100");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.createClaimableBalance({
        asset: Asset.native(),
        amount: opts?.amount ?? "10",
        claimants: opts?.claimants ?? [
          new Claimant(
            dest,
            Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(unlock)),
          ),
        ],
      }),
    )
    .setTimeout(opts?.timeout ?? 120)
    .build();
  return { unsigned: tx.toXDR(), now: Math.floor(Date.now() / 1000), unlock, dest };
}

function confirm(over: Partial<VaultHandoffConfirm> = {}): VaultHandoffConfirm {
  return {
    action: "Time-Lock deposit",
    amount: "10 XLM",
    recipient: RECIPIENT.publicKey(),
    unlockDate: "1 Jan 2027",
    confirmed: true,
    ...over,
  };
}

describe("Scopuly SEP-7 handoff", () => {
  it("stays off, and the info screen does not build a link", () => {
    assert.equal(SCOPULY_SEP7_HANDOFF_ENABLED, false);
    assert.equal(VAULT_WITHDRAW_REQUIRES_SCOPULY, false);
    const screen = readFileSync("app/scopuly.tsx", "utf8");
    assert.doesNotMatch(screen, /buildWebStellarTxUri|prepareScopulyRequest|secretSeed/);
    assert.doesNotMatch(screen, /ScopulyHandoffConfirm|callback|origin_domain/);
    assert.doesNotMatch(screen, /scopuly\.com|web wallet|\bSCOP\b|yield/i);
    assert.match(screen, /SCOPULY_X_URL/);
    assert.match(screen, /SCOPULY_PLAY_URL/);
    assert.match(screen, /SCOPULY_PLAY_MARKET/);
    const playStart = screen.indexOf("const openPlay");
    const addressStart = screen.indexOf("const openWithAddress");
    const playFn = screen.slice(playStart, addressStart);
    assert.doesNotMatch(playFn, /Clipboard|setStringAsync|publicKey/);
    assert.match(playFn, /SCOPULY_PLAY_MARKET/);
    assert.match(playFn, /SCOPULY_PLAY_URL/);
    const addressFn = screen.slice(addressStart, screen.indexOf("return ("));
    assert.match(addressFn, /Clipboard\.setStringAsync/);
    assert.match(addressFn, /openScopulyApp/);
    assert.match(addressFn, /Address copied, opening Scopuly/);
    assert.match(addressFn, /try \{/);
    assert.match(addressFn, /catch \{/);
    assert.doesNotMatch(addressFn, /web\+stellar:pay|scopuly:\/\//);
    assert.match(screen, /scopuly-open-with-address/);
    assert.match(screen, /scopuly-open-play/);
    assert.match(screen, /playHit: \{[\s\S]*width: 140,[\s\S]*height: 54/);
    assert.doesNotMatch(screen, /position:\s*"absolute"/);
  });

  it("links only the Play listing and X, with no token or yield copy", () => {
    assert.equal(SCOPULY_X_URL, "https://x.com/scopuly");
    assert.equal(SCOPULY_ANDROID_PACKAGE, "com.sdex.app");
    assert.equal(
      SCOPULY_PLAY_URL,
      "https://play.google.com/store/apps/details?id=com.sdex.app",
    );
    assert.equal(SCOPULY_PLAY_MARKET, "market://details?id=com.sdex.app");
    const copy = SCOPULY_FEATURES.map((item) => `${item.title} ${item.detail}`).join("\n");
    assert.doesNotMatch(copy, /\bSCOP\b|yield|web wallet|scopuly\.com/i);
  });

  it("builds a package launch intent and falls back to the Play listing", () => {
    const uri = scopulyLaunchIntentUri();
    assert.equal(
      uri,
      "intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=com.sdex.app;end",
    );
    assert.throws(() => scopulyLaunchIntentUri("not a package"));
    const opener = readFileSync("src/scopuly/open-app.ts", "utf8");
    assert.match(opener, /SCOPULY_PLAY_MARKET/);
    assert.match(opener, /SCOPULY_PLAY_URL/);
    assert.doesNotMatch(opener, /web\+stellar:pay|buildWebStellarTxUri|prepareScopulyRequest/);
    const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    assert.match(manifest, /<package android:name="com\.sdex\.app"\s*\/>/);
    const home = readFileSync("app/(tabs)/wallet.tsx", "utf8");
    assert.match(home, /Explore Scopuly/);
    assert.doesNotMatch(home, /Connect this wallet/);
  });

  it("builds a web+stellar:tx link and refuses callback, origin_domain, and seeds", () => {
    const { unsigned } = payment({ timeout: 120 });
    const uri = buildWebStellarTxUri({
      xdr: unsigned,
      pubkey: SOURCE.publicKey(),
      msg: "Time-Lock deposit",
    });
    assert.ok(uri.startsWith("web+stellar:tx?"));
    const params = new URLSearchParams(uri.slice("web+stellar:tx?".length));
    assert.equal(params.get("xdr"), unsigned);
    assert.equal(params.get("pubkey"), SOURCE.publicKey());
    assert.equal(params.get("callback"), null);
    assert.equal(params.get("origin_domain"), null);
    assert.equal(params.get("signature"), null);
    assert.throws(() =>
      buildWebStellarTxUri({
        xdr: unsigned,
        pubkey: SECRET,
      }),
    );
    assert.throws(() =>
      buildWebStellarTxUri({
        xdr: unsigned,
        pubkey: SOURCE.publicKey(),
        callback: "url:https://example.com/hook",
      } as never),
    );
    assert.throws(() =>
      buildWebStellarTxUri({
        xdr: unsigned,
        pubkey: SOURCE.publicKey(),
        origin_domain: "stellartimelock.com",
      } as never),
    );
  });

  it("requires amount, recipient, and unlock date, one action, and a 5-minute expiry", () => {
    const locked = claimable();
    const ready = prepareScopulyRequest({
      xdr: locked.unsigned,
      pubkey: SOURCE.publicKey(),
      confirm: confirm(),
      nowSec: locked.now,
      networkPassphrase: Networks.TESTNET,
    });
    assert.match(ready.uri, /^web\+stellar:tx\?/);
    assert.doesNotMatch(ready.uri, /callback|origin_domain|signature=/);

    assert.throws(() =>
      prepareScopulyRequest({
        xdr: locked.unsigned,
        pubkey: SOURCE.publicKey(),
        confirm: confirm({ amount: "" }),
        nowSec: locked.now,
        networkPassphrase: Networks.TESTNET,
      }),
    );
    assert.throws(() =>
      prepareScopulyRequest({
        xdr: locked.unsigned,
        pubkey: SOURCE.publicKey(),
        confirm: confirm({ recipient: "Northwind" }),
        nowSec: locked.now,
        networkPassphrase: Networks.TESTNET,
      }),
    );
    assert.throws(() =>
      prepareScopulyRequest({
        xdr: locked.unsigned,
        pubkey: SOURCE.publicKey(),
        confirm: confirm({ unlockDate: "" }),
        nowSec: locked.now,
        networkPassphrase: Networks.TESTNET,
      }),
    );

    const two = payment({ timeout: 120, ops: 2 });
    assert.throws(() =>
      prepareScopulyRequest({
        xdr: two.unsigned,
        pubkey: SOURCE.publicKey(),
        confirm: confirm(),
        nowSec: two.now,
        networkPassphrase: Networks.TESTNET,
      }),
    );

    const long = payment({ timeout: 900 });
    assert.throws(() =>
      prepareScopulyRequest({
        xdr: long.unsigned,
        pubkey: SOURCE.publicKey(),
        confirm: confirm(),
        nowSec: long.now,
        networkPassphrase: Networks.TESTNET,
      }),
    );
  });

  it("refuses a confirm screen that does not match the decoded envelope", () => {
    const locked = claimable();
    const base = {
      xdr: locked.unsigned,
      pubkey: SOURCE.publicKey(),
      nowSec: locked.now,
      networkPassphrase: Networks.TESTNET,
    };
    const ready = prepareScopulyRequest({ ...base, confirm: confirm({ unlockDate: "2027-01-01" }) });
    assert.match(ready.uri, /^web\+stellar:tx\?/);
    prepareScopulyRequest({ ...base, confirm: confirm({ unlockDate: UNLOCK_UNIX }) });

    assert.throws(
      () => prepareScopulyRequest({ ...base, confirm: confirm({ amount: "1 XLM" }) }),
      /amount on the confirm screen does not match/,
    );
    assert.throws(
      () => prepareScopulyRequest({ ...base, confirm: confirm({ amount: "10 USD" }) }),
      /amount on the confirm screen does not match/,
    );
    assert.throws(
      () =>
        prepareScopulyRequest({
          ...base,
          confirm: confirm({ recipient: SOURCE.publicKey() }),
        }),
      /recipient on the confirm screen does not match/,
    );
    assert.throws(
      () => prepareScopulyRequest({ ...base, confirm: confirm({ unlockDate: "2 Jan 2027" }) }),
      /unlock date on the confirm screen does not match/,
    );

    const paid = payment({ timeout: 120 });
    assert.throws(
      () =>
        prepareScopulyRequest({
          xdr: paid.unsigned,
          pubkey: SOURCE.publicKey(),
          confirm: confirm({ amount: "1 XLM", recipient: RECIPIENT.publicKey() }),
          nowSec: paid.now,
          networkPassphrase: Networks.TESTNET,
        }),
      /unlock date on the confirm screen does not match/,
    );
    assert.throws(
      () =>
        prepareScopulyRequest({
          xdr: paid.unsigned,
          pubkey: SOURCE.publicKey(),
          confirm: confirm({ amount: "10 XLM" }),
          nowSec: paid.now,
          networkPassphrase: Networks.TESTNET,
        }),
      /amount on the confirm screen does not match/,
    );

    const second = Keypair.random();
    const twoRecipients = claimable({
      claimants: [
        new Claimant(
          RECIPIENT.publicKey(),
          Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(UNLOCK_UNIX)),
        ),
        new Claimant(second.publicKey(), Claimant.predicateUnconditional()),
      ],
    });
    assert.throws(
      () =>
        prepareScopulyRequest({
          xdr: twoRecipients.unsigned,
          pubkey: SOURCE.publicKey(),
          confirm: confirm(),
          nowSec: twoRecipients.now,
          networkPassphrase: Networks.TESTNET,
        }),
      /does not include one recipient/,
    );
  });

  it("compares return hashes without Node crypto", () => {
    const source = readFileSync("src/scopuly/verify-return.ts", "utf8");
    assert.doesNotMatch(source, /from ["']crypto["']/);
    assert.doesNotMatch(source, /node:crypto/);
    assert.doesNotMatch(source, /timingSafeEqual/);
    const same = new Uint8Array([1, 2, 3, 4]);
    assert.equal(constantTimeEqual(same, new Uint8Array([1, 2, 3, 4])), true);
    assert.equal(constantTimeEqual(same, new Uint8Array([1, 2, 3, 5])), false);
    assert.equal(constantTimeEqual(same, new Uint8Array([1, 2, 3])), false);
  });

  it("accepts a signed return only when the body matches and the expected key signed", () => {
    const { unsigned, tx } = payment({ timeout: 120 });
    tx.sign(SOURCE);
    const signed = tx.toXDR();
    const ok = verifySignedReturn({
      originalXdr: unsigned,
      signedXdr: signed,
      expectedPublicKey: SOURCE.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    assert.equal(ok.ok, true);

    const other = payment({ timeout: 120, source: Keypair.random() });
    other.tx.sign(other.source);
    const mismatch = verifySignedReturn({
      originalXdr: unsigned,
      signedXdr: other.tx.toXDR(),
      expectedPublicKey: SOURCE.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    assert.equal(mismatch.ok, false);

    const stranger = Keypair.random();
    const { unsigned: bare, tx: resigned } = payment({ timeout: 120 });
    resigned.sign(stranger);
    const wrongKey = verifySignedReturn({
      originalXdr: bare,
      signedXdr: resigned.toXDR(),
      expectedPublicKey: SOURCE.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    assert.equal(wrongKey.ok, false);
  });

  it("keeps withdraw and unlock off the Scopuly path", () => {
    const vault = readFileSync("app/vault/[id].tsx", "utf8");
    const advanced = readFileSync("src/wallet/advanced-vaults/client.ts", "utf8");
    const standard = readFileSync("src/api/soroban-client.ts", "utf8");
    for (const source of [vault, advanced, standard]) {
      assert.doesNotMatch(source, /src\/scopuly|prepareScopulyRequest|web\+stellar:tx/);
    }
    const confirmUi = readFileSync("src/scopuly/ScopulyHandoffConfirm.tsx", "utf8");
    assert.match(confirmUi, /Amount/);
    assert.match(confirmUi, /Recipient/);
    assert.match(confirmUi, /Unlock date/);
    assert.match(confirmUi, /scopuly-confirm-amount/);
  });
});
