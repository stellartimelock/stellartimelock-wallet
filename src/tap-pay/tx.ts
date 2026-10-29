// Build and sign a native XLM payment.
//
// The secret is the seed-derived Stellar key. This module does not wrap
// that key in a device-bound cipher. Callers decide when the seed may be
// read; the biometric gate lives in sign.ts and only wraps the call.

import {
  Account,
  Asset,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { keypairIfUnlocked } from "../wallet/sign-lock";

import { wipeKeypair } from "@/src/security/secure-wipe";

import { MEMO_TEXT_MAX_BYTES } from "./constants";
import { canonicalAmount, parseAmountToStroops, utf8Length } from "./money";

export interface BuiltPayment {
  xdr: string;
  source: string;
}

export function buildSignedPayment(opts: {
  sourceSecret: string;
  sequence: string;
  destination: string;
  amount: string;
  memo: string;
  networkPassphrase: string;
  feeStroops?: string;
  createAccount?: boolean;
}): BuiltPayment {
  const amount = canonicalAmount(opts.amount);
  if (!amount) throw new Error("Amount must be a positive XLM amount.");
  if (utf8Length(opts.memo) > MEMO_TEXT_MAX_BYTES) {
    throw new Error("Memo is longer than 28 bytes.");
  }
  if (
    opts.networkPassphrase !== Networks.TESTNET &&
    opts.networkPassphrase !== Networks.PUBLIC
  ) {
    throw new Error("Network passphrase is not testnet or mainnet.");
  }
  const fee = opts.feeStroops && /^\d+$/.test(opts.feeStroops) ? opts.feeStroops : "1000";
  const source = keypairIfUnlocked(opts.sourceSecret);
  try {
    if (source.publicKey() === opts.destination) {
      throw new Error("Choose a different recipient.");
    }
    if (opts.createAccount) {
      const stroops = parseAmountToStroops(amount);
      if (stroops == null || stroops < 10_000_000n) {
        throw new Error("A new Stellar account needs at least 1 XLM.");
      }
    }
    const account = new Account(source.publicKey(), opts.sequence);
    const builder = new TransactionBuilder(account, {
      fee,
      networkPassphrase: opts.networkPassphrase,
    });
    if (opts.createAccount) {
      builder.addOperation(
        Operation.createAccount({
          destination: opts.destination,
          startingBalance: amount,
        }),
      );
    } else {
      builder.addOperation(
        Operation.payment({
          destination: opts.destination,
          asset: Asset.native(),
          amount,
        }),
      );
    }
    if (opts.memo.length > 0) builder.addMemo(Memo.text(opts.memo));
    builder.setTimeout(60);
    const tx = builder.build();
    tx.sign(source);
    return { xdr: tx.toXDR(), source: source.publicKey() };
  } finally {
    wipeKeypair(source);
  }
}
