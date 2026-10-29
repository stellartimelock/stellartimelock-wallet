// Card "Pay now" hands Stellar Vault a fill request. The request carries
// the nickname, last 4, brand, and an opaque vault id — never a PAN or CVV.
// Opening the biller page is the caller's job, and only after approval.

import type { Bill, CardMethod, CoinbaseCardMethod, PaymentMethod } from "./bills";
import { containsCardNumber, sanitizePaymentMethod } from "./bills";
import type { ApprovalMethod } from "./plan";
import { isValidApproval } from "./plan";

export interface CardFillRequest {
  billId: string;
  paymentMethodId: string;
  vaultRef: string;
  nickname: string;
  last4: string;
  brand: string;
  payUrl: string;
  approvedAt: number;
  approvalMethod: ApprovalMethod;
}

export type FillResult =
  | { ok: true; request: CardFillRequest }
  | { ok: false; code: "approval_required" | "not_a_card" | "missing_pay_url" | "card_secret"; message: string };

function isCard(method: PaymentMethod): method is CardMethod | CoinbaseCardMethod {
  return method.kind === "card" || method.kind === "coinbase_card";
}

/**
 * Build the payload Stellar Vault uses to autofill. Returns before any
 * URL is involved when the user has not approved.
 */
export function buildCardFillRequest(input: {
  bill: Bill;
  method: PaymentMethod;
  approval: { method: ApprovalMethod; at: number } | null;
}): FillResult {
  if (!isValidApproval(input.approval)) {
    return {
      ok: false,
      code: "approval_required",
      message: "Approve to Fill before the biller page opens.",
    };
  }
  const sanitized = sanitizePaymentMethod(input.method);
  if (!sanitized.ok) {
    return { ok: false, code: "card_secret", message: sanitized.error };
  }
  const method = sanitized.method;
  if (!isCard(method)) {
    return {
      ok: false,
      code: "not_a_card",
      message: "XLM bills are paid with an approved transfer, not card fill.",
    };
  }
  const payUrl = input.bill.payUrl.trim();
  if (!/^https?:\/\//i.test(payUrl)) {
    return { ok: false, code: "missing_pay_url", message: "This bill has no pay link." };
  }
  const request: CardFillRequest = {
    billId: input.bill.id,
    paymentMethodId: method.id,
    vaultRef: method.vaultRef,
    nickname: method.nickname,
    last4: method.last4,
    brand: method.brand,
    payUrl,
    approvedAt: input.approval.at,
    approvalMethod: input.approval.method,
  };
  if (containsCardNumber(JSON.stringify(request))) {
    return {
      ok: false,
      code: "card_secret",
      message: "Refusing to hand a card number to the fill request.",
    };
  }
  return { ok: true, request };
}
