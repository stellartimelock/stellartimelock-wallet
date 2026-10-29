// Donation completion. The thank-you screen runs only after this accepts.
// The shipping app passes a sender that signs and submits the XLM payment
// on device. This file does not broadcast a transaction.

export interface DonationDraft {
  amountXlm: string;
  stroops: string;
  memo: string;
}

export type DonationSender = (draft: DonationDraft) => Promise<void>;

export type DonationOutcome =
  | { ok: true; amountXlm: string }
  | { ok: false; reason: string };

export const DONATION_MEMO = "donation";

const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;

export function parseDonationAmount(
  raw: string,
): { ok: true; amountXlm: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: "Enter an XLM amount with up to 7 decimal places.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: "Enter an amount greater than zero." };
  }
  const [whole, frac] = trimmed.split(".");
  const amountXlm = `${String(BigInt(whole))}${frac ? `.${frac}` : ""}`;
  return { ok: true, amountXlm };
}

/** Exact stroop integer (1 XLM = 10_000_000 stroops) for the payment sender. */
export function amountToStroops(amountXlm: string): string {
  const [whole, frac = ""] = amountXlm.split(".");
  const padded = `${frac}0000000`.slice(0, 7);
  return (BigInt(whole) * 10_000_000n + BigInt(padded)).toString();
}

export async function completeDonation(
  rawAmount: string,
  send: DonationSender,
): Promise<DonationOutcome> {
  const parsed = parseDonationAmount(rawAmount);
  if (!parsed.ok) return parsed;
  const draft: DonationDraft = {
    amountXlm: parsed.amountXlm,
    stroops: amountToStroops(parsed.amountXlm),
    memo: DONATION_MEMO,
  };
  try {
    await send(draft);
  } catch (caught) {
    const reason =
      caught instanceof Error && caught.message
        ? caught.message
        : "The donation could not be completed.";
    return { ok: false, reason };
  }
  return { ok: true, amountXlm: parsed.amountXlm };
}

/**
 * Reference stand-in used by the published donate screen.
 * Resolves without contacting the network. The shipping donate screen
 * does not call this — it submits a signed payment and leaves the
 * thank-you behind `completeDonation`'s success branch.
 */
export async function referenceDonationSender(
  _draft: DonationDraft,
): Promise<void> {
  return;
}
