// Payment plans. Parsing and quoting never broadcast.
// `submitApprovedPlan` is the only path that may call a broadcaster,
// and it returns before that call unless the plan carries a fresh approval.

import type { Bill, PaymentMethod } from "./bills";
import { billsDueThisWeek, scheduleBill } from "./bills";
import type { HelperAccount } from "./helper";
import { remainingUsd, reserveHelperSpend, rollWeek } from "./helper";
import { compareDecimal, formatUsd, MoneyError, quoteUsdInXlm, quoteXlm } from "./math";
import type { MoneyAmount, ParsedRequest } from "./parse";
import { parseRequest } from "./parse";

export type DestinationKind = "private" | "exchange" | "casino" | "donation";
export type ApprovalMethod = "biometric" | "pin";

export type PlanBlocker =
  | "needs_amount"
  | "needs_contact"
  | "unknown_recipient"
  | "ambiguous_recipient"
  | "needs_rate"
  | "needs_memo"
  | "needs_payee"
  | "helper_frozen"
  | "over_weekly_limit"
  | "helper_disabled";

export interface Approval {
  method: ApprovalMethod;
  at: number;
}

export interface SendPlan {
  id: string;
  intent: "send" | "card_topup" | "helper_spend";
  summary: string;
  recipientLabel: string | null;
  destination: string | null;
  memo: string;
  destinationKind: DestinationKind;
  amountXlm: string | null;
  amountUsd: string | null;
  rateUsdPerXlm: string | null;
  feeXlm: string | null;
  feeIsEstimate: boolean;
  totalXlm: string | null;
  blockers: PlanBlocker[];
  /** Always true. A plan cannot opt out of approval. */
  requiresApproval: true;
  approval: Approval | null;
  submitted: boolean;
}

export interface ContactRef {
  id: string;
  label: string;
  publicKey: string;
  memo: string;
  kind: DestinationKind;
}

export interface PlanContext {
  contacts: ContactRef[];
  coinbaseCardContactId: string | null;
  /** Null while offline or before the first successful rate lookup. */
  rateUsdPerXlm: string | null;
  /** Null until fee stats are fetched. The quote then uses the protocol minimum. */
  feeStroops: number | null;
  helper: HelperAccount;
  today: string;
  bills: Bill[];
  paymentMethods: PaymentMethod[];
  nowMs?: number;
}

export type Interpretation =
  | { type: "bills"; title: string; lines: string[] }
  | { type: "plan"; plan: SendPlan }
  | { type: "clarify"; message: string };

let idSeq = 0;
function planId(now: number): string {
  idSeq += 1;
  return `plan_${now.toString(36)}_${idSeq.toString(36)}`;
}

function blankPlan(partial: Omit<SendPlan, "requiresApproval" | "approval" | "submitted"> & {
  approval?: Approval | null;
}): SendPlan {
  return {
    ...partial,
    requiresApproval: true,
    approval: partial.approval ?? null,
    submitted: false,
  };
}

function methodLabel(methods: PaymentMethod[], id: string | null): string {
  if (!id) return "no payment method";
  const m = methods.find((x) => x.id === id);
  if (!m) return "missing method";
  if (m.kind === "xlm") return m.nickname || "XLM";
  const brand = m.brand[0].toUpperCase() + m.brand.slice(1);
  return `${m.nickname} (${brand} ••${m.last4})`;
}

function findCoinbase(ctx: PlanContext): ContactRef | null {
  if (ctx.coinbaseCardContactId) {
    const hit = ctx.contacts.find((c) => c.id === ctx.coinbaseCardContactId);
    if (hit) return hit;
  }
  const labeled = ctx.contacts.filter((c) => /coinbase\s*card/i.test(c.label));
  return labeled.length === 1 ? labeled[0] : null;
}

function resolveRecipient(
  name: string,
  contacts: ContactRef[],
): { contact: ContactRef | null; blocker: PlanBlocker | null } {
  const n = name.trim().toLowerCase();
  const exact = contacts.filter((c) => c.label.trim().toLowerCase() === n);
  if (exact.length === 1) return { contact: exact[0], blocker: null };
  if (exact.length > 1) return { contact: null, blocker: "ambiguous_recipient" };
  const starts = contacts.filter((c) => c.label.trim().toLowerCase().startsWith(n));
  if (starts.length === 1) return { contact: starts[0], blocker: null };
  return { contact: null, blocker: "unknown_recipient" };
}

function applyQuote(
  plan: SendPlan,
  amount: MoneyAmount,
  ctx: PlanContext,
): SendPlan {
  const blockers = [...plan.blockers];
  try {
    if (amount.currency === "USD") {
      if (!ctx.rateUsdPerXlm) {
        blockers.push("needs_rate");
        return {
          ...plan,
          amountUsd: amount.value,
          blockers,
          summary: plan.summary,
        };
      }
      const quote = quoteUsdInXlm(amount.value, ctx.rateUsdPerXlm, ctx.feeStroops);
      return {
        ...plan,
        amountUsd: quote.amountUsd,
        amountXlm: quote.amountXlm,
        rateUsdPerXlm: quote.rateUsdPerXlm,
        feeXlm: quote.feeXlm,
        feeIsEstimate: quote.feeIsEstimate,
        totalXlm: quote.totalXlm,
        blockers,
      };
    }
    const quote = quoteXlm(amount.value, ctx.rateUsdPerXlm, ctx.feeStroops);
    return {
      ...plan,
      amountUsd: quote.amountUsd,
      amountXlm: quote.amountXlm,
      rateUsdPerXlm: quote.rateUsdPerXlm,
      feeXlm: quote.feeXlm,
      feeIsEstimate: quote.feeIsEstimate,
      totalXlm: quote.totalXlm,
      blockers,
    };
  } catch (e) {
    const message = e instanceof MoneyError ? e.message : "Amount could not be quoted.";
    return {
      ...plan,
      blockers: blockers.includes("needs_amount") ? blockers : [...blockers, "needs_amount"],
      summary: `${plan.summary} ${message}`,
    };
  }
}

function feeSentence(plan: SendPlan): string {
  if (!plan.feeXlm) return "";
  const live = plan.feeIsEstimate ? " (network minimum until a live fee loads)" : "";
  const total = plan.totalXlm ? ` Total with fee: ${plan.totalXlm} XLM.` : "";
  return ` Network fee ${plan.feeXlm} XLM${live}.${total}`;
}

function finishSummary(plan: SendPlan, lead: string): SendPlan {
  let detail = "";
  if (plan.amountXlm) {
    const usd =
      plan.amountUsd != null ? ` ($${formatUsd(plan.amountUsd)})` : "";
    const rate = plan.rateUsdPerXlm ? ` Rate ${plan.rateUsdPerXlm} USD/XLM.` : "";
    detail = ` Exact amount ${plan.amountXlm} XLM${usd}.${rate}${feeSentence(plan)}`;
  } else if (plan.blockers.includes("needs_rate")) {
    detail = " Exact XLM needs a live rate. Planning works offline; the lookup needs a connection.";
  }
  const hold = " Nothing is sent until you tap Approve.";
  return { ...plan, summary: `${lead}${detail}${hold}` };
}

function planTopUp(amount: MoneyAmount | null, ctx: PlanContext): SendPlan {
  const now = ctx.nowMs ?? Date.now();
  const contact = findCoinbase(ctx);
  const blockers: PlanBlocker[] = [];
  if (!amount) blockers.push("needs_amount");
  if (!contact) blockers.push("needs_contact");
  else if (
    (contact.kind === "exchange" || contact.kind === "casino") &&
    contact.memo.trim().length === 0
  ) {
    blockers.push("needs_memo");
  }
  let plan = blankPlan({
    id: planId(now),
    intent: "card_topup",
    summary: "",
    recipientLabel: contact?.label ?? "card deposit",
    destination: contact?.publicKey ?? null,
    memo: contact?.memo ?? "",
    destinationKind: contact?.kind ?? "exchange",
    amountXlm: null,
    amountUsd: amount?.currency === "USD" ? amount.value : null,
    rateUsdPerXlm: null,
    feeXlm: null,
    feeIsEstimate: false,
    totalXlm: null,
    blockers,
  });
  if (amount) plan = applyQuote(plan, amount, ctx);
  const who = contact ? contact.label : "your card deposit";
  const howMuch = amount
    ? amount.currency === "USD"
      ? `$${formatUsd(amount.value)}`
      : `${amount.value} XLM`
    : "an amount you still need to choose";
  return finishSummary(plan, `Top up ${who} with ${howMuch}.`);
}

function planSend(amount: MoneyAmount, recipient: string, ctx: PlanContext): SendPlan {
  const now = ctx.nowMs ?? Date.now();
  const resolved = resolveRecipient(recipient, ctx.contacts);
  const blockers: PlanBlocker[] = [];
  if (resolved.blocker) blockers.push(resolved.blocker);
  const contact = resolved.contact;
  if (
    contact &&
    (contact.kind === "exchange" || contact.kind === "casino") &&
    contact.memo.trim().length === 0
  ) {
    blockers.push("needs_memo");
  }
  let plan = blankPlan({
    id: planId(now),
    intent: "send",
    summary: "",
    recipientLabel: contact?.label ?? recipient,
    destination: contact?.publicKey ?? null,
    memo: contact?.memo ?? "",
    destinationKind: contact?.kind ?? "private",
    amountXlm: null,
    amountUsd: null,
    rateUsdPerXlm: null,
    feeXlm: null,
    feeIsEstimate: false,
    totalXlm: null,
    blockers,
  });
  plan = applyQuote(plan, amount, ctx);
  const how =
    amount.currency === "USD" ? `$${formatUsd(amount.value)}` : `${amount.value} XLM`;
  return finishSummary(plan, `Send ${how} to ${contact?.label ?? recipient}.`);
}

function overWeeklyCap(amount: MoneyAmount, helper: HelperAccount, ctx: PlanContext): boolean {
  const left = remainingUsd(helper, ctx.today);
  if (amount.currency === "USD") return compareDecimal(amount.value, left) > 0;
  if (!ctx.rateUsdPerXlm) return false;
  try {
    const quote = quoteXlm(amount.value, ctx.rateUsdPerXlm, null);
    return quote.amountUsd != null && compareDecimal(quote.amountUsd, left) > 0;
  } catch {
    return false;
  }
}

function planSpend(amount: MoneyAmount, ctx: PlanContext): SendPlan {
  const now = ctx.nowMs ?? Date.now();
  const helper = rollWeek(ctx.helper, ctx.today);
  const blockers: PlanBlocker[] = [];
  if (!helper.enabled) blockers.push("helper_disabled");
  else if (helper.frozen) blockers.push("helper_frozen");
  else if (overWeeklyCap(amount, helper, ctx)) blockers.push("over_weekly_limit");

  let plan = blankPlan({
    id: planId(now),
    intent: "helper_spend",
    summary: "",
    recipientLabel: null,
    destination: null,
    memo: "",
    destinationKind: "private",
    amountXlm: null,
    amountUsd: null,
    rateUsdPerXlm: null,
    feeXlm: null,
    feeIsEstimate: false,
    totalXlm: null,
    blockers,
  });
  plan = applyQuote(plan, amount, ctx);
  const how =
    amount.currency === "USD" ? `$${formatUsd(amount.value)}` : `${amount.value} XLM`;
  const cap = helper.enabled
    ? ` Weekly cap $${formatUsd(helper.weeklyLimitUsd)}, $${formatUsd(remainingUsd(helper, ctx.today))} left.`
    : " Helper spending is off — this is a quote only.";
  return finishSummary(plan, `Set aside ${how} in helper spending.${cap}`);
}

export function interpret(text: string, ctx: PlanContext): Interpretation {
  return interpretParsed(parseRequest(text), ctx);
}

export function interpretParsed(parsed: ParsedRequest, ctx: PlanContext): Interpretation {
  if (parsed.intent === "unknown") {
    return {
      type: "clarify",
      message:
        "Try “I need $10 to spend”, “send 20 XLM to Mom”, “top up my card with $25”, or “what bills are due this week?”. Nothing is sent from here on its own.",
    };
  }
  if (parsed.intent === "bills_due") {
    const due = billsDueThisWeek(ctx.bills, ctx.today);
    if (due.length === 0) {
      return { type: "bills", title: "Nothing is due this week.", lines: [] };
    }
    const lines = due.map((bill) => {
      const schedule = scheduleBill(bill, ctx.today);
      const when = schedule.payTiming === "now" ? "pay now" : `pay on ${schedule.dueOn}`;
      const auto = bill.autopay ? "autopay ready — still needs Approve" : "manual";
      return `${bill.name} — $${formatUsd(bill.amount)} — due ${bill.dueDate} — ${methodLabel(ctx.paymentMethods, bill.paymentMethodId)} — ${when} — ${auto}`;
    });
    return { type: "bills", title: "Bills due this week", lines };
  }
  if (parsed.intent === "top_up_card") {
    return { type: "plan", plan: planTopUp(parsed.amount, ctx) };
  }
  if (parsed.intent === "send") {
    return { type: "plan", plan: planSend(parsed.amount, parsed.recipient, ctx) };
  }
  return { type: "plan", plan: planSpend(parsed.amount, ctx) };
}

/** XLM bill payment. Card bills use `buildCardFillRequest` instead. */
export function planBillXlmPayment(bill: Bill, ctx: PlanContext): SendPlan {
  const now = ctx.nowMs ?? Date.now();
  const blockers: PlanBlocker[] = [];
  if (!bill.payeeAddress) blockers.push("needs_payee");
  let plan = blankPlan({
    id: planId(now),
    intent: "send",
    summary: "",
    recipientLabel: bill.name,
    destination: bill.payeeAddress || null,
    memo: bill.payeeMemo,
    destinationKind: "private",
    amountXlm: null,
    amountUsd: bill.amount,
    rateUsdPerXlm: null,
    feeXlm: null,
    feeIsEstimate: false,
    totalXlm: null,
    blockers,
  });
  plan = applyQuote(plan, { value: bill.amount, currency: "USD" }, ctx);
  return finishSummary(plan, `Pay ${bill.name} ($${formatUsd(bill.amount)}) in XLM.`);
}

export function isValidApproval(approval: Approval | null): approval is Approval {
  if (!approval) return false;
  if (approval.method !== "biometric" && approval.method !== "pin") return false;
  return typeof approval.at === "number" && Number.isFinite(approval.at) && approval.at > 0;
}

export function approvePlan(
  plan: SendPlan,
  approval: Approval,
): { ok: true; plan: SendPlan } | { ok: false; code: "blocked" | "invalid_approval" | "already_submitted"; plan: SendPlan } {
  if (plan.submitted) return { ok: false, code: "already_submitted", plan };
  if (!isValidApproval(approval)) return { ok: false, code: "invalid_approval", plan };
  if (plan.blockers.length > 0) return { ok: false, code: "blocked", plan };
  return { ok: true, plan: { ...plan, approval, requiresApproval: true } };
}

export interface BroadcastInput {
  destination: string;
  amountXlm: string;
  memo: string;
  kindId: DestinationKind;
}

export type BroadcastFn = (
  input: BroadcastInput,
) => Promise<{ ok: boolean; message?: string; hash?: string }>;

export type SubmitCode =
  | "ok"
  | "approval_required"
  | "blocked"
  | "incomplete"
  | "already_submitted"
  | "not_a_send"
  | "broadcast_failed";

export interface SubmitResult {
  ok: boolean;
  code: SubmitCode;
  message: string;
  plan: SendPlan;
}

/**
 * Broadcast only when the plan is an approved send or card top-up.
 * Helper spending is not a chain transfer. Missing approval returns
 * before `broadcast` is invoked.
 */
export async function submitApprovedPlan(
  plan: SendPlan,
  broadcast: BroadcastFn,
): Promise<SubmitResult> {
  if (plan.submitted) {
    return { ok: false, code: "already_submitted", message: "This transfer was already submitted.", plan };
  }
  if (!isValidApproval(plan.approval)) {
    return {
      ok: false,
      code: "approval_required",
      message: "Approve with biometrics or device PIN before anything is sent.",
      plan,
    };
  }
  if (plan.intent === "helper_spend") {
    return {
      ok: false,
      code: "not_a_send",
      message: "Helper spending stays on this phone. It does not submit a transfer.",
      plan,
    };
  }
  if (plan.blockers.length > 0) {
    return { ok: false, code: "blocked", message: "This plan is missing a detail, so it was not sent.", plan };
  }
  if (!plan.destination || !plan.amountXlm) {
    return { ok: false, code: "incomplete", message: "Destination or amount is missing.", plan };
  }
  const outcome = await broadcast({
    destination: plan.destination,
    amountXlm: plan.amountXlm,
    memo: plan.memo,
    kindId: plan.destinationKind,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      code: "broadcast_failed",
      message: outcome.message ?? "The network did not accept the transfer.",
      plan,
    };
  }
  return {
    ok: true,
    code: "ok",
    message: outcome.hash ? `Submitted ${outcome.hash}` : "Submitted.",
    plan: { ...plan, submitted: true },
  };
}

/**
 * UI entry for "Approve and send". A failed biometric check never reaches
 * the broadcaster. Helper plans are rejected here as well.
 */
/**
 * Record an approved helper set-aside in the local allowance.
 * Does not accept a broadcaster — there is nothing to submit.
 */
export function commitHelperSpend(
  plan: SendPlan,
  helper: HelperAccount,
  today: string,
  now = Date.now(),
): { ok: boolean; code: SubmitCode | "not_helper"; message: string; helper: HelperAccount; plan: SendPlan } {
  if (plan.intent !== "helper_spend") {
    return {
      ok: false,
      code: "not_helper",
      message: "Only a helper spending plan can be set aside.",
      helper,
      plan,
    };
  }
  if (!isValidApproval(plan.approval)) {
    return {
      ok: false,
      code: "approval_required",
      message: "Approve the set-aside first. Nothing was reserved.",
      helper,
      plan,
    };
  }
  if (plan.blockers.length > 0 || !plan.amountUsd) {
    return {
      ok: false,
      code: "blocked",
      message: "This set-aside is missing a detail.",
      helper,
      plan,
    };
  }
  const reserved = reserveHelperSpend(helper, plan.amountUsd, plan.amountXlm, today, now);
  if (!reserved.ok) {
    return {
      ok: false,
      code: "blocked",
      message:
        reserved.code === "frozen"
          ? "Helper spending is frozen."
          : reserved.code === "disabled"
            ? "Helper spending is off."
            : "That is over the weekly limit.",
      helper: reserved.helper,
      plan,
    };
  }
  return {
    ok: true,
    code: "ok",
    message: `Set aside $${formatUsd(plan.amountUsd)} in helper spending.`,
    helper: reserved.helper,
    plan: { ...plan, submitted: true },
  };
}

export async function sendIfApproved(
  plan: SendPlan,
  auth: { ok: boolean; method: ApprovalMethod; at: number },
  broadcast: BroadcastFn,
): Promise<SubmitResult> {
  if (!auth.ok) {
    return {
      ok: false,
      code: "approval_required",
      message: "Approval was cancelled. Nothing was sent.",
      plan,
    };
  }
  const approved = approvePlan(plan, { method: auth.method, at: auth.at });
  if (!approved.ok) {
    return {
      ok: false,
      code: approved.code === "blocked" ? "blocked" : "approval_required",
      message: "This plan cannot be sent yet.",
      plan,
    };
  }
  return submitApprovedPlan(approved.plan, broadcast);
}
