// Bills and saved payment methods.
//
// Cards store a nickname, brand, and last 4 only. Full card numbers stay
// in Stellar Vault; this module rejects any payload that carries one.
// Scheduling is local. Autopay prepares a payment on the due date — it
// does not submit. Every XLM payment and every card fill still needs Approve.

import { addDays, addMonths, addYears, isIsoDate, mondayOf, reminderFireAtMs } from "./dates";
import { fromUnits, MoneyError, toUnits } from "./math";

export const CARD_BRANDS = ["visa", "mastercard", "amex", "discover", "other"] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export type PayTiming = "now" | "due_date";
export type BillRepeat = "none" | "weekly" | "monthly" | "yearly";

interface MethodBase {
  id: string;
  nickname: string;
  createdAt: number;
  updatedAt: number;
}

export interface CardMethod extends MethodBase {
  kind: "card";
  last4: string;
  brand: CardBrand;
  /** Opaque id Stellar Vault uses to find the real card. */
  vaultRef: string;
}

export interface CoinbaseCardMethod extends MethodBase {
  kind: "coinbase_card";
  last4: string;
  brand: CardBrand;
  vaultRef: string;
  /** Address-book row: Coinbase XLM deposit address and memo. */
  contactId: string | null;
}

export interface XlmMethod extends MethodBase {
  kind: "xlm";
}

export type PaymentMethod = CardMethod | CoinbaseCardMethod | XlmMethod;

export interface Bill {
  id: string;
  name: string;
  /** Decimal USD. */
  amount: string;
  /** YYYY-MM-DD */
  dueDate: string;
  autopay: boolean;
  paymentMethodId: string | null;
  payTiming: PayTiming;
  /** Biller page opened for a card payment. */
  payUrl: string;
  /** Destination when the method is XLM. */
  payeeAddress: string;
  payeeMemo: string;
  reminderDaysBefore: number;
  repeat: BillRepeat;
  createdAt: number;
  updatedAt: number;
  /** Set when a one-shot bill has been marked paid. */
  paidOn: string | null;
}

export interface BillSchedule {
  billId: string;
  name: string;
  amount: string;
  dueOn: string;
  remindOn: string;
  /** When the payment should be prepared. Still requires Approve. */
  payOn: string;
  status: "upcoming" | "due" | "overdue" | "paid";
  payTiming: PayTiming;
  autopay: boolean;
  needsApproval: true;
  reminderDue: boolean;
}

const SECRET_KEYS = new Set([
  "pan",
  "cvv",
  "cvc",
  "cvv2",
  "number",
  "cardnumber",
  "card_number",
  "fullnumber",
  "full_number",
  "expiry",
  "expiration",
  "exp",
  "pin",
  "securitycode",
  "security_code",
  "track",
]);

/** 13–19 digits, spaces and dashes allowed. Last-4 alone does not match. */
const PAN_RUN = /\d(?:[ -]?\d){12,18}/;

export function containsCardNumber(value: string): boolean {
  return PAN_RUN.test(value);
}

function rejectSecrets(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (SECRET_KEYS.has(key.toLowerCase().replace(/[^a-z0-9_]/g, ""))) {
      return "Full card numbers stay in Stellar Vault. This wallet stores nickname, brand, and last 4 only.";
    }
  }
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && containsCardNumber(value)) {
      return "That looks like a full card number. Store it in Stellar Vault, not in this wallet.";
    }
  }
  return null;
}

function asBrand(value: unknown): CardBrand | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (CARD_BRANDS as readonly string[]).includes(v) ? (v as CardBrand) : null;
}

function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  if (!nickname || nickname.length > 40) return null;
  if (containsCardNumber(nickname)) return null;
  return nickname;
}

export function sanitizePaymentMethod(
  input: unknown,
  now = Date.now(),
): { ok: true; method: PaymentMethod } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Payment method is not an object." };
  }
  const obj = input as Record<string, unknown>;
  const secret = rejectSecrets(obj);
  if (secret) return { ok: false, error: secret };

  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : "";
  if (!id) return { ok: false, error: "Payment method is missing an id." };
  const nickname = cleanNickname(obj.nickname);
  if (!nickname) return { ok: false, error: "Nickname is required." };
  const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : now;
  const updatedAt = typeof obj.updatedAt === "number" ? obj.updatedAt : now;
  const kind = obj.kind;

  if (kind === "xlm") {
    return {
      ok: true,
      method: { id, kind: "xlm", nickname, createdAt, updatedAt },
    };
  }

  if (kind !== "card" && kind !== "coinbase_card") {
    return { ok: false, error: "Unknown payment method." };
  }
  const last4 = typeof obj.last4 === "string" ? obj.last4.trim() : "";
  if (!/^\d{4}$/.test(last4)) {
    return { ok: false, error: "Last 4 must be exactly four digits." };
  }
  const brand = asBrand(obj.brand);
  if (!brand) return { ok: false, error: "Card brand is not recognized." };
  const vaultRef = typeof obj.vaultRef === "string" ? obj.vaultRef.trim() : "";
  if (vaultRef && containsCardNumber(vaultRef)) {
    return { ok: false, error: "Stellar Vault reference cannot be a card number." };
  }
  if (kind === "card") {
    return {
      ok: true,
      method: { id, kind: "card", nickname, last4, brand, vaultRef, createdAt, updatedAt },
    };
  }
  const contactId =
    typeof obj.contactId === "string" && obj.contactId.trim() ? obj.contactId.trim() : null;
  return {
    ok: true,
    method: {
      id,
      kind: "coinbase_card",
      nickname,
      last4,
      brand,
      vaultRef,
      contactId,
      createdAt,
      updatedAt,
    },
  };
}

function cleanAmount(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    value = String(value);
  }
  if (typeof value !== "string") return null;
  try {
    const units = toUnits(value);
    if (units <= 0n) return null;
    return fromUnits(units);
  } catch {
    return null;
  }
}

const STELLAR_G = /^G[A-Z2-7]{55}$/;

export function sanitizeBill(
  input: unknown,
  now = Date.now(),
): { ok: true; bill: Bill } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Bill is not an object." };
  }
  const obj = input as Record<string, unknown>;
  const secret = rejectSecrets(obj);
  if (secret) return { ok: false, error: secret };

  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : "";
  if (!id) return { ok: false, error: "Bill is missing an id." };
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name || name.length > 80) return { ok: false, error: "Bill name is required." };
  if (containsCardNumber(name)) {
    return { ok: false, error: "Bill name cannot contain a card number." };
  }
  const amount = cleanAmount(obj.amount);
  if (!amount) return { ok: false, error: "Bill amount must be a positive number." };
  const dueDate = typeof obj.dueDate === "string" ? obj.dueDate.trim() : "";
  if (!isIsoDate(dueDate)) return { ok: false, error: "Due date must be YYYY-MM-DD." };

  const payTiming: PayTiming = obj.payTiming === "now" ? "now" : "due_date";
  const repeat: BillRepeat =
    obj.repeat === "weekly" || obj.repeat === "monthly" || obj.repeat === "yearly"
      ? obj.repeat
      : "none";
  let reminderDaysBefore = 3;
  if (typeof obj.reminderDaysBefore === "number" && Number.isFinite(obj.reminderDaysBefore)) {
    reminderDaysBefore = Math.max(0, Math.min(60, Math.floor(obj.reminderDaysBefore)));
  }
  const payUrl = typeof obj.payUrl === "string" ? obj.payUrl.trim() : "";
  if (payUrl && !/^https?:\/\//i.test(payUrl)) {
    return { ok: false, error: "Pay link must start with http:// or https://." };
  }
  const payeeAddress = typeof obj.payeeAddress === "string" ? obj.payeeAddress.trim() : "";
  if (payeeAddress && !STELLAR_G.test(payeeAddress)) {
    return { ok: false, error: "XLM payee must be a Stellar G-address." };
  }
  const payeeMemo = typeof obj.payeeMemo === "string" ? obj.payeeMemo.trim() : "";
  if (new TextEncoder().encode(payeeMemo).length > 28) {
    return { ok: false, error: "Memo must be 28 bytes or less." };
  }
  const paidOn =
    typeof obj.paidOn === "string" && isIsoDate(obj.paidOn) ? obj.paidOn : null;

  return {
    ok: true,
    bill: {
      id,
      name,
      amount,
      dueDate,
      autopay: obj.autopay === true || obj.autopay === "true" || obj.autopay === "yes",
      paymentMethodId:
        typeof obj.paymentMethodId === "string" && obj.paymentMethodId.trim()
          ? obj.paymentMethodId.trim()
          : null,
      payTiming,
      payUrl,
      payeeAddress,
      payeeMemo,
      reminderDaysBefore,
      repeat,
      createdAt: typeof obj.createdAt === "number" ? obj.createdAt : now,
      updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : now,
      paidOn,
    },
  };
}

export function isPaid(bill: Bill): boolean {
  return bill.repeat === "none" && bill.paidOn != null;
}

export function scheduleBill(bill: Bill, today: string): BillSchedule {
  if (!isIsoDate(today)) throw new MoneyError("Today must be YYYY-MM-DD.");
  const remindOn = addDays(bill.dueDate, -bill.reminderDaysBefore);
  const payOn = bill.payTiming === "now" ? today : bill.dueDate;
  let status: BillSchedule["status"];
  if (isPaid(bill)) status = "paid";
  else if (today > bill.dueDate) status = "overdue";
  else if (today === bill.dueDate) status = "due";
  else status = "upcoming";
  return {
    billId: bill.id,
    name: bill.name,
    amount: bill.amount,
    dueOn: bill.dueDate,
    remindOn,
    payOn,
    status,
    payTiming: bill.payTiming,
    autopay: bill.autopay,
    needsApproval: true,
    reminderDue: !isPaid(bill) && today >= remindOn,
  };
}

/** Bills whose due date falls in the Monday–Sunday UTC week of `today`. */
export function billsDueThisWeek(bills: Bill[], today: string): Bill[] {
  const start = mondayOf(today);
  const end = addDays(start, 6);
  return bills
    .filter((b) => !isPaid(b) && b.dueDate >= start && b.dueDate <= end)
    .slice()
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name)));
}

export function nextDueDate(due: string, repeat: BillRepeat): string {
  if (repeat === "weekly") return addDays(due, 7);
  if (repeat === "monthly") return addMonths(due, 1);
  if (repeat === "yearly") return addYears(due, 1);
  return due;
}

export function markBillPaid(bill: Bill, onDate: string, now = Date.now()): Bill {
  if (!isIsoDate(onDate)) throw new MoneyError("Paid date must be YYYY-MM-DD.");
  if (bill.repeat === "none") {
    return { ...bill, paidOn: onDate, updatedAt: now };
  }
  return {
    ...bill,
    paidOn: onDate,
    dueDate: nextDueDate(bill.dueDate, bill.repeat),
    updatedAt: now,
  };
}

export interface ReminderPlan {
  billId: string;
  fireAtMs: number;
  title: string;
  body: string;
}

/** Reminders that should still be scheduled. Past reminders are omitted. */
export function billReminderPlans(bills: Bill[], today: string, nowMs: number): ReminderPlan[] {
  const plans: ReminderPlan[] = [];
  for (const bill of bills) {
    if (isPaid(bill)) continue;
    const schedule = scheduleBill(bill, today);
    const fireAtMs = reminderFireAtMs(schedule.remindOn);
    if (fireAtMs <= nowMs) continue;
    plans.push({
      billId: bill.id,
      fireAtMs,
      title: `${bill.name} is coming up`,
      body: `$${bill.amount} due ${bill.dueDate}. Open Bills to approve payment.`,
    });
  }
  return plans;
}

/**
 * Autopay bills whose pay date has arrived. The returned schedules still
 * have `needsApproval: true` — nothing here is a submitted payment.
 */
export function autopayDue(bills: Bill[], today: string): BillSchedule[] {
  return bills
    .filter((b) => b.autopay && !isPaid(b))
    .map((b) => scheduleBill(b, today))
    .filter((s) => today >= s.payOn);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

export interface CsvImportResult {
  bills: Bill[];
  errors: { line: number; message: string }[];
}

/**
 * Import bills from a CSV. Required columns: name, amount, dueDate.
 * Optional: autopay, payTiming, paymentMethodId, payUrl, payeeAddress,
 * payeeMemo, reminderDaysBefore, repeat.
 */
export function parseBillsCsv(text: string, now = Date.now()): CsvImportResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { bills: [], errors: [{ line: 1, message: "CSV is empty." }] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const amountIdx = header.indexOf("amount");
  const dueIdx = header.indexOf("duedate") >= 0 ? header.indexOf("duedate") : header.indexOf("due");
  if (nameIdx < 0 || amountIdx < 0 || dueIdx < 0) {
    return {
      bills: [],
      errors: [{ line: 1, message: "CSV needs name, amount, and dueDate columns." }],
    };
  }
  const col = (cells: string[], key: string): string => {
    const idx = header.indexOf(key);
    return idx >= 0 ? (cells[idx] ?? "") : "";
  };
  const bills: Bill[] = [];
  const errors: { line: number; message: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const reminderRaw = col(cells, "reminderdaysbefore");
    const draft = {
      id: `bill_csv_${now.toString(36)}_${i}`,
      name: cells[nameIdx] ?? "",
      amount: cells[amountIdx] ?? "",
      dueDate: cells[dueIdx] ?? "",
      autopay: col(cells, "autopay"),
      payTiming: col(cells, "paytiming"),
      paymentMethodId: col(cells, "paymentmethodid"),
      payUrl: col(cells, "payurl"),
      payeeAddress: col(cells, "payeeaddress"),
      payeeMemo: col(cells, "payeememo"),
      reminderDaysBefore: reminderRaw === "" ? 3 : Number(reminderRaw),
      repeat: col(cells, "repeat") || "none",
      createdAt: now,
      updatedAt: now,
    };
    const parsed = sanitizeBill(draft, now);
    if (!parsed.ok) errors.push({ line: i + 1, message: parsed.error });
    else bills.push(parsed.bill);
  }
  return { bills, errors };
}
