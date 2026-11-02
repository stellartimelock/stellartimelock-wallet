// Rules for a Scopuly vault handoff, before any link is built.
//
// Scopuly's signing screen can show a claimable-balance lock as only
// "Create Claimable Balance operation", with no amount, recipient, or
// unlock date. This wallet shows those three itself, and the user
// confirms them, before a link exists.
//
// Each link is one operation and expires within five minutes.
// callback and origin_domain are not added here.

import {
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { isStellarPublicKey } from "@/src/wallet/strkey";

import { assertConfirmMatchesEnvelope } from "./confirm-bind";
import { buildWebStellarTxUri } from "./sep7-tx";

/** Upper bound on (maxTime - now). Five minutes. */
export const HANDOFF_MAX_TTL_SEC = 300;

export interface VaultHandoffConfirm {
  /** One vault action, in plain language. */
  action: string;
  /** Amount that moves, or "0 XLM — no funds move". */
  amount: string;
  /** Account that receives funds, or the account that is acting. */
  recipient: string;
  /** Unlock, release, deadline, or check-in date. */
  unlockDate: string;
  confirmed: true;
}

export interface PreparedHandoff {
  uri: string;
  xdr: string;
  pubkey: string;
  confirm: VaultHandoffConfirm;
}

function requireText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} has to be on the confirm screen.`);
  return text;
}

/** Refuse a handoff whose confirm screen omits amount, recipient, or date. */
export function assertVaultConfirm(confirm: VaultHandoffConfirm): void {
  if (confirm.confirmed !== true) {
    throw new Error("The confirm screen has to be accepted first.");
  }
  requireText(confirm.action, "The vault action");
  const amount = requireText(confirm.amount, "The amount");
  if (!/\d/.test(amount)) {
    throw new Error("The amount has to be on the confirm screen.");
  }
  const recipient = requireText(confirm.recipient, "The recipient");
  if (!isStellarPublicKey(recipient)) {
    throw new Error("The recipient on the confirm screen must be a public key.");
  }
  const date = requireText(confirm.unlockDate, "The unlock date");
  if (/^unknown$/i.test(date)) {
    throw new Error("The unlock date has to be on the confirm screen.");
  }
}

export function assertSingleActionTimebound(
  tx: Transaction,
  nowSec: number,
): void {
  if (tx.operations.length !== 1) {
    throw new Error("Each Scopuly request is one vault action.");
  }
  if (tx.signatures.length !== 0) {
    throw new Error("The request has to be unsigned.");
  }
  const bounds = tx.timeBounds;
  if (!bounds) throw new Error("The request needs a short expiry.");
  const min = Number(bounds.minTime);
  const max = Number(bounds.maxTime);
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("The request needs a short expiry.");
  }
  const remaining = max - nowSec;
  if (remaining <= 0 || remaining > HANDOFF_MAX_TTL_SEC) {
    throw new Error("The request has to expire within 5 minutes.");
  }
  if (min > 0 && max - min > HANDOFF_MAX_TTL_SEC) {
    throw new Error("The request has to expire within 5 minutes.");
  }
}

/**
 * Check the confirm screen and the unsigned envelope, then build the
 * link. The amount, recipient, and unlock date on the screen have to
 * be the ones decoded from the operation. Does not attach callback or
 * origin_domain. Callers must keep this behind
 * SCOPULY_SEP7_HANDOFF_ENABLED.
 */
export function prepareScopulyRequest(input: {
  xdr: string;
  pubkey: string;
  msg?: string;
  confirm: VaultHandoffConfirm;
  nowSec: number;
  networkPassphrase: string;
}): PreparedHandoff {
  assertVaultConfirm(input.confirm);
  const pubkey = input.pubkey.trim();
  if (!isStellarPublicKey(pubkey)) {
    throw new Error("Scopuly account must be a public key.");
  }
  let parsed: Transaction;
  try {
    const envelope = TransactionBuilder.fromXDR(input.xdr, input.networkPassphrase);
    if (envelope instanceof FeeBumpTransaction || !(envelope instanceof Transaction)) {
      throw new Error("Fee-bump envelopes are not accepted.");
    }
    parsed = envelope;
  } catch (error) {
    if (error instanceof Error && error.message === "Fee-bump envelopes are not accepted.") {
      throw error;
    }
    throw new Error("Transaction XDR could not be read.");
  }
  if (parsed.source !== pubkey) {
    throw new Error("The transaction source must be the Scopuly public key.");
  }
  assertSingleActionTimebound(parsed, input.nowSec);
  assertConfirmMatchesEnvelope(parsed, input.confirm);
  const uri = buildWebStellarTxUri({
    xdr: input.xdr.trim(),
    pubkey,
    msg: input.msg ?? input.confirm.action,
  });
  return { uri, xdr: input.xdr.trim(), pubkey, confirm: input.confirm };
}
