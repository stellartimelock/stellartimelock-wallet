// Bind the confirm screen to the decoded envelope.
//
// The screen can say "10 XLM" while the XDR pays a different amount.
// `prepareScopulyRequest` refuses that. The amount, recipient, and
// unlock date have to be the ones in the single operation. The
// five-minute timebound is the link expiry, not the unlock date.

import { Transaction } from "@stellar/stellar-sdk";

const STROOPS = 10_000_000n;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const AMOUNT_RE =
  /^(\d{1,18}(?:\.\d{1,7})?)\s+([A-Za-z0-9]{1,12})(?:\s+(?:—|-)\s+no funds move)?$/;

export interface ConfirmFacts {
  amount: string;
  recipient: string;
  unlockDate: string;
}

interface EnvelopeFacts {
  stroops: bigint;
  asset: string;
  recipient: string;
  /** Unix seconds. Null when the operation has no absolute unlock time. */
  unlockUnix: string | null;
}

type PredicateNode = {
  switch: () => { name: string };
  absBefore: () => { toString: () => string };
  notPredicate: () => PredicateNode | null;
  andPredicates: () => PredicateNode[];
  orPredicates: () => PredicateNode[];
};

type AssetLike = {
  isNative?: () => boolean;
  getCode?: () => string;
};

type OperationLike = {
  type?: string;
  amount?: string;
  asset?: AssetLike;
  destination?: string;
  claimants?: Array<{ destination: string; predicate: PredicateNode }>;
};

function decimalToStroops(value: string): bigint | null {
  const match = value.match(/^(\d{1,18})(?:\.(\d{1,7}))?$/);
  if (!match) return null;
  const frac = (match[2] ?? "").padEnd(7, "0");
  return BigInt(match[1]) * STROOPS + BigInt(frac);
}

function assetCode(asset: AssetLike | undefined): string | null {
  if (!asset) return null;
  if (asset.isNative?.()) return "XLM";
  const code = asset.getCode?.();
  return code ? code.toUpperCase() : null;
}

function collectAbsoluteTimes(predicate: PredicateNode, found: string[]): boolean {
  const name = predicate.switch().name;
  if (name === "claimPredicateUnconditional") return false;
  if (name === "claimPredicateBeforeRelativeTime") return true;
  if (name === "claimPredicateBeforeAbsoluteTime") {
    found.push(predicate.absBefore().toString());
    return false;
  }
  if (name === "claimPredicateNot") {
    const inner = predicate.notPredicate();
    return inner ? collectAbsoluteTimes(inner, found) : true;
  }
  if (name === "claimPredicateAnd" || name === "claimPredicateOr") {
    const parts =
      name === "claimPredicateAnd" ? predicate.andPredicates() : predicate.orPredicates();
    return parts.some((part) => collectAbsoluteTimes(part, found));
  }
  return true;
}

function fromClaimable(op: OperationLike): EnvelopeFacts {
  const amount = op.amount ?? "";
  const stroops = decimalToStroops(amount);
  const asset = assetCode(op.asset);
  const claimants = op.claimants ?? [];
  const destinations = [...new Set(claimants.map((claimant) => claimant.destination))];
  if (stroops === null || !asset) {
    throw new Error(
      "The transaction does not include an amount, a recipient, and an unlock date.",
    );
  }
  if (destinations.length !== 1) {
    throw new Error("The transaction does not include one recipient.");
  }
  const times: string[] = [];
  const relative = claimants.some((claimant) => collectAbsoluteTimes(claimant.predicate, times));
  const unique = [...new Set(times)];
  if (relative || unique.length !== 1) {
    throw new Error("The transaction does not include an unlock date.");
  }
  return {
    stroops,
    asset,
    recipient: destinations[0],
    unlockUnix: unique[0],
  };
}

function fromPayment(op: OperationLike): EnvelopeFacts {
  const stroops = decimalToStroops(op.amount ?? "");
  const asset = assetCode(op.asset);
  const recipient = op.destination?.trim() ?? "";
  if (stroops === null || !asset || !recipient) {
    throw new Error(
      "The transaction does not include an amount, a recipient, and an unlock date.",
    );
  }
  return { stroops, asset, recipient, unlockUnix: null };
}

function readEnvelope(tx: Transaction): EnvelopeFacts {
  const op = tx.operations[0] as OperationLike | undefined;
  if (op?.type === "createClaimableBalance") return fromClaimable(op);
  if (op?.type === "payment") return fromPayment(op);
  throw new Error(
    "The transaction does not include an amount, a recipient, and an unlock date.",
  );
}

function confirmAmount(shown: string): { stroops: bigint; asset: string } {
  const match = shown.trim().match(AMOUNT_RE);
  if (!match) {
    throw new Error("The amount on the confirm screen does not match the transaction.");
  }
  const stroops = decimalToStroops(match[1]);
  const asset = match[2].toUpperCase();
  const saysNoFunds = /no funds move/.test(shown);
  if (stroops === null || (saysNoFunds && stroops !== 0n)) {
    throw new Error("The amount on the confirm screen does not match the transaction.");
  }
  return { stroops, asset };
}

function utcDay(unixSec: string): { y: number; m: number; d: number } | null {
  if (!/^\d{1,12}$/.test(unixSec)) return null;
  const sec = Number(unixSec);
  if (!Number.isSafeInteger(sec)) return null;
  const date = new Date(sec * 1000);
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
  };
}

function unlockMatches(shown: string, unixSec: string): boolean {
  const text = shown.trim();
  if (/^\d+$/.test(text)) return text === unixSec;
  const day = utcDay(unixSec);
  if (!day) return false;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return Number(iso[1]) === day.y && Number(iso[2]) === day.m && Number(iso[3]) === day.d;
  }
  const human = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!human) return false;
  const month = MONTHS[human[2].toLowerCase()];
  const date = Number(human[1]);
  if (!month || date < 1 || date > 31) return false;
  return date === day.d && month === day.m && Number(human[3]) === day.y;
}

/** Refuse a confirm screen whose amount, recipient, or date is not in the operation. */
export function assertConfirmMatchesEnvelope(tx: Transaction, confirm: ConfirmFacts): void {
  const facts = readEnvelope(tx);
  const shown = confirmAmount(confirm.amount);
  if (shown.stroops !== facts.stroops || shown.asset !== facts.asset) {
    throw new Error("The amount on the confirm screen does not match the transaction.");
  }
  if (confirm.recipient.trim() !== facts.recipient) {
    throw new Error("The recipient on the confirm screen does not match the transaction.");
  }
  if (!facts.unlockUnix || !unlockMatches(confirm.unlockDate, facts.unlockUnix)) {
    throw new Error("The unlock date on the confirm screen does not match the transaction.");
  }
}
