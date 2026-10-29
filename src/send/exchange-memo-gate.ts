// Exchange memo gate — pure, no React Native imports (unit-tested in node).
//
// Why this exists: SimpleSwap (and most custodial exchanges) receive XLM
// on ONE shared deposit address and tell deposits apart by the memo. A
// payment to that address without the memo confirms on-chain but is never
// credited, and recovery costs a support ticket plus fees. The wallet
// therefore refuses to sign such a payment, whatever kind chip is selected.

/** A deposit address the wallet learned from a swap it created. */
export interface KnownDeposit {
  /** Stellar G-address the exchange told us to pay. */
  address: string;
  /** Memo the exchange requires for this deposit (null = none returned). */
  memo: string | null;
  /** e.g. "simpleswap". */
  provider: string;
  /** Exchange id, for support. */
  exchangeId?: string;
  /** Unix seconds. */
  createdAt: number;
}

export type MemoGateReason =
  | "memo_required_kind"
  | "exchange_memo_missing"
  | "exchange_memo_mismatch"
  | "exchange_memo_unknown"
  | "account_memo_required"
  | "memo_too_long";

export type MemoGateResult =
  | { ok: true }
  | { ok: false; reason: MemoGateReason; message: string };

const MEMO_REQUIRED_KINDS = new Set(["exchange", "casino"]);

/** Max registry size; oldest entries drop first. */
export const MAX_KNOWN_DEPOSITS = 50;

const normAddr = (a: string): string => (a ?? "").trim().toUpperCase();
const normMemo = (m: string | null | undefined): string => (m ?? "").trim();

/** Stellar MEMO_TEXT is capped at 28 bytes of UTF-8. */
export function memoFitsText(memo: string): boolean {
  return new TextEncoder().encode(memo).length <= 28;
}

/**
 * SEP-29: an account that sets data entry `config.memo_required` = "1"
 * (base64 "MQ==") says every incoming payment needs a memo. Exchanges
 * set this on their deposit accounts.
 */
export function accountRequiresMemo(
  data: Record<string, string> | null | undefined,
): boolean {
  const v = data?.["config.memo_required"];
  if (typeof v !== "string") return false;
  return v === "MQ==" || v === "1";
}

/** All known deposits for an address, newest first. */
export function findDeposits(
  known: readonly KnownDeposit[],
  address: string,
): KnownDeposit[] {
  const a = normAddr(address);
  return known
    .filter((d) => normAddr(d.address) === a)
    .sort((x, y) => y.createdAt - x.createdAt);
}

/** Insert or refresh a deposit; keeps the newest MAX_KNOWN_DEPOSITS. */
export function upsertDeposit(
  known: readonly KnownDeposit[],
  entry: KnownDeposit,
  max: number = MAX_KNOWN_DEPOSITS,
): KnownDeposit[] {
  const a = normAddr(entry.address);
  const m = normMemo(entry.memo);
  const rest = known.filter(
    (d) => !(normAddr(d.address) === a && normMemo(d.memo) === m),
  );
  const next = [
    { ...entry, address: a, memo: m.length ? m : null },
    ...rest,
  ].sort((x, y) => y.createdAt - x.createdAt);
  return next.slice(0, Math.max(1, max));
}

/** Parse the persisted registry; garbage in -> empty list. */
export function parseKnownDeposits(raw: string | null | undefined): KnownDeposit[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (d): d is KnownDeposit =>
        !!d &&
        typeof d.address === "string" &&
        /^G[A-Z2-7]{55}$/.test(d.address) &&
        (d.memo === null || typeof d.memo === "string") &&
        typeof d.createdAt === "number",
    );
  } catch {
    return [];
  }
}

/**
 * The single decision used by the Send screen, the swap auto-send and
 * broadcastPayment(). Returns ok:false whenever signing would risk an
 * uncredited exchange deposit.
 *
 * - `requiredMemo` (swap auto-send): the memo MUST equal it exactly, and
 *   a swap whose provider returned no memo for an XLM deposit is refused.
 * - Known exchange deposit address (from a swap this wallet created):
 *   memo may not be empty.
 * - SEP-29 `config.memo_required` on the destination account: memo may
 *   not be empty.
 * - Exchange / casino kind chip: memo may not be empty (existing rule).
 */
export function checkExchangeMemo(input: {
  destination: string;
  memo: string;
  kindId?: string;
  knownDeposits?: readonly KnownDeposit[];
  destinationRequiresMemo?: boolean;
  /** undefined = not a swap send; null/"" = swap returned no memo. */
  requiredMemo?: string | null;
}): MemoGateResult {
  const memo = normMemo(input.memo);

  if (memo.length > 0 && !memoFitsText(memo)) {
    return {
      ok: false,
      reason: "memo_too_long",
      message: "Memo is longer than Stellar's 28-byte limit.",
    };
  }

  if (input.requiredMemo !== undefined) {
    const req = normMemo(input.requiredMemo);
    if (req.length === 0) {
      return {
        ok: false,
        reason: "exchange_memo_unknown",
        message:
          "The swap provider didn't return a deposit memo, so this payment " +
          "can't be credited. Nothing was sent. Start a new swap.",
      };
    }
    if (memo !== req) {
      return {
        ok: false,
        reason: memo.length === 0 ? "exchange_memo_missing" : "exchange_memo_mismatch",
        message:
          "The memo doesn't match the one the swap provider requires for " +
          "this deposit. Nothing was sent.",
      };
    }
    return { ok: true };
  }

  if (memo.length > 0) return { ok: true };

  const matches = findDeposits(input.knownDeposits ?? [], input.destination);
  if (matches.some((d) => normMemo(d.memo).length > 0)) {
    return {
      ok: false,
      reason: "exchange_memo_missing",
      message:
        "This is a swap deposit address and needs its memo. Without it " +
        "the exchange can't credit the payment. Nothing was sent.",
    };
  }
  if (input.destinationRequiresMemo) {
    return {
      ok: false,
      reason: "account_memo_required",
      message:
        "This address says every payment needs a memo (it's an exchange or " +
        "custodial account). Add the memo they gave you. Nothing was sent.",
    };
  }
  if (MEMO_REQUIRED_KINDS.has(input.kindId ?? "private")) {
    return {
      ok: false,
      reason: "memo_required_kind",
      message:
        "A memo is REQUIRED when sending to an exchange or casino. " +
        "Add the deposit memo from your account before signing — " +
        "without it the platform cannot credit your deposit.",
    };
  }
  return { ok: true };
}
