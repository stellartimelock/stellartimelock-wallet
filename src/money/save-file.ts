// The one plain money save file.
//
// A single JSON document holds bills, payment methods, helper spending,
// and the Coinbase-card contact id. Older wallet backups (envelope v1–v8)
// have no `money` document — reading them reports the section as absent
// so a restore does not wipe bills the phone already has. Unknown fields
// are dropped. Card secrets are rejected rather than stored.

import type { Bill, PaymentMethod } from "./bills";
import { sanitizeBill, sanitizePaymentMethod } from "./bills";
import { emptyHelper, type HelperAccount } from "./helper";
import { isIsoDate, todayIso } from "./dates";
import { fromUnits, toUnits } from "./math";

export const MONEY_SAVE_VERSION = 1 as const;
export const MONEY_SAVE_KEY = "xlm_vault_money_save_v1";

export interface MoneySaveFile {
  v: typeof MONEY_SAVE_VERSION;
  writtenAt: number;
  bills: Bill[];
  paymentMethods: PaymentMethod[];
  helper: HelperAccount;
  coinbaseCardContactId: string | null;
}

export function emptyMoneySave(now = Date.now()): MoneySaveFile {
  return {
    v: MONEY_SAVE_VERSION,
    writtenAt: 0,
    bills: [],
    paymentMethods: [],
    helper: emptyHelper(todayIso(now), now),
    coinbaseCardContactId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function looksLikeEnvelope(obj: Record<string, unknown>): boolean {
  if (typeof obj.device === "string") return true;
  if (Array.isArray(obj.addresses) && (Array.isArray(obj.notes) || "walletMeta" in obj || "keyManager" in obj)) {
    return true;
  }
  return false;
}

function parseHelper(raw: unknown, now: number): HelperAccount {
  const fallback = emptyHelper(todayIso(now), now);
  if (!isRecord(raw)) return fallback;
  const week = typeof raw.weekStartedOn === "string" && isIsoDate(raw.weekStartedOn)
    ? raw.weekStartedOn
    : fallback.weekStartedOn;
  const decimal = (value: unknown, fallbackValue: string): string => {
    if (typeof value !== "string" && typeof value !== "number") return fallbackValue;
    try {
      return fromUnits(toUnits(String(value)));
    } catch {
      return fallbackValue;
    }
  };
  return {
    enabled: raw.enabled === true,
    weeklyLimitUsd: decimal(raw.weeklyLimitUsd, "0"),
    weekStartedOn: week,
    spentUsd: decimal(raw.spentUsd, "0"),
    frozen: raw.frozen === true,
    allocatedXlm: decimal(raw.allocatedXlm, "0"),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function parseFileObject(obj: Record<string, unknown>, now: number): MoneySaveFile {
  const bills: Bill[] = [];
  if (Array.isArray(obj.bills)) {
    for (const entry of obj.bills) {
      const parsed = sanitizeBill(entry, now);
      if (parsed.ok) bills.push(parsed.bill);
    }
  }
  const paymentMethods: PaymentMethod[] = [];
  if (Array.isArray(obj.paymentMethods)) {
    for (const entry of obj.paymentMethods) {
      const parsed = sanitizePaymentMethod(entry, now);
      if (parsed.ok) paymentMethods.push(parsed.method);
    }
  }
  const contact =
    typeof obj.coinbaseCardContactId === "string" && obj.coinbaseCardContactId.trim()
      ? obj.coinbaseCardContactId.trim()
      : null;
  return {
    v: MONEY_SAVE_VERSION,
    writtenAt: typeof obj.writtenAt === "number" ? obj.writtenAt : now,
    bills,
    paymentMethods,
    helper: parseHelper(obj.helper, now),
    coinbaseCardContactId: contact,
  };
}

export interface MoneyRead {
  /** False when the payload has no money document. Callers must keep local data. */
  present: boolean;
  file: MoneySaveFile;
}

/**
 * Read a money document, a backup envelope, or an older save.
 * `present: false` means "this file does not speak about money" —
 * including legacy envelopes whose `bills` array is only `{id, createdAt}` stubs.
 */
export function readMoneyDocument(raw: unknown, now = Date.now()): MoneyRead {
  const empty = emptyMoneySave(now);
  if (raw == null || raw === "") return { present: false, file: empty };
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { present: false, file: empty };
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { present: false, file: empty };
    }
  }
  if (!isRecord(value)) return { present: false, file: empty };

  if (looksLikeEnvelope(value)) {
    if (!isRecord(value.money)) return { present: false, file: empty };
    return { present: true, file: parseFileObject(value.money, now) };
  }

  const hasMoneyShape =
    Array.isArray(value.paymentMethods) ||
    isRecord(value.helper) ||
    "coinbaseCardContactId" in value ||
    (Array.isArray(value.bills) &&
      value.bills.some(
        (b) => isRecord(b) && typeof b.name === "string" && typeof b.dueDate === "string",
      ));
  if (!hasMoneyShape) return { present: false, file: empty };
  return { present: true, file: parseFileObject(value, now) };
}

function mergeRows<T extends { id: string; updatedAt: number }>(
  local: T[],
  incoming: T[],
  mode: "restore" | "import",
): T[] {
  const byId = new Map<string, T>();
  for (const row of local) byId.set(row.id, row);
  for (const row of incoming) {
    const prev = byId.get(row.id);
    if (!prev || row.updatedAt >= prev.updatedAt) byId.set(row.id, row);
  }
  if (mode === "restore") {
    const incomingIds = new Set(incoming.map((row) => row.id));
    for (const id of byId.keys()) {
      if (!incomingIds.has(id)) byId.delete(id);
    }
  }
  return [...byId.values()];
}

export function mergeMoneySave(
  local: MoneySaveFile,
  incoming: MoneySaveFile,
  mode: "restore" | "import",
): MoneySaveFile {
  const helper =
    incoming.helper.updatedAt >= local.helper.updatedAt ? incoming.helper : local.helper;
  const coinbaseCardContactId =
    incoming.writtenAt >= local.writtenAt
      ? incoming.coinbaseCardContactId
      : local.coinbaseCardContactId;
  return {
    v: MONEY_SAVE_VERSION,
    writtenAt: Math.max(local.writtenAt, incoming.writtenAt),
    bills: mergeRows(local.bills, incoming.bills, mode),
    paymentMethods: mergeRows(local.paymentMethods, incoming.paymentMethods, mode),
    helper,
    coinbaseCardContactId,
  };
}
