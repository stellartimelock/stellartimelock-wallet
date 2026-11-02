// A signed envelope may come back from Scopuly later. Nothing submits
// it unless the body matches the unsigned transaction we built and a
// signature on that body verifies under the expected public key.
//
// Fee-bump wrappers are refused. callback and origin_domain are not
// read here. This module does not submit.

import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { constantTimeEqual } from "./constant-time";

export type VerifyResult =
  | { ok: true; signedXdr: string }
  | { ok: false; reason: string };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return constantTimeEqual(a, b);
}

export function verifySignedReturn(input: {
  originalXdr: string;
  signedXdr: string;
  expectedPublicKey: string;
  networkPassphrase: string;
}): VerifyResult {
  let signed: Transaction;
  try {
    const original = TransactionBuilder.fromXDR(
      input.originalXdr,
      input.networkPassphrase,
    );
    const returned = TransactionBuilder.fromXDR(
      input.signedXdr,
      input.networkPassphrase,
    );
    if (
      original instanceof FeeBumpTransaction ||
      returned instanceof FeeBumpTransaction ||
      !(original instanceof Transaction) ||
      !(returned instanceof Transaction)
    ) {
      return { ok: false, reason: "Fee-bump envelopes are not accepted." };
    }
    if (!sameBytes(original.hash(), returned.hash())) {
      return {
        ok: false,
        reason: "Signed transaction does not match the one we built.",
      };
    }
    signed = returned;
  } catch {
    return { ok: false, reason: "Envelope could not be read." };
  }

  if (signed.operations.length !== 1) {
    return { ok: false, reason: "Signed transaction must be a single action." };
  }

  let signer: Keypair;
  try {
    signer = Keypair.fromPublicKey(input.expectedPublicKey);
  } catch {
    return { ok: false, reason: "Expected key is not a public key." };
  }

  const hash = signed.hash();
  const matched = signed.signatures.some((sig) => {
    try {
      return signer.verify(hash, sig.signature());
    } catch {
      return false;
    }
  });
  if (!matched) {
    return { ok: false, reason: "Missing a valid signature from the Scopuly key." };
  }
  return { ok: true, signedXdr: input.signedXdr };
}
