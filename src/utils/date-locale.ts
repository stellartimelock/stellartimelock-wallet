import type { Currency } from "@/src/state/session";

export function localeForCurrency(currency: Currency | undefined): string | undefined {
  if (currency === "USD") return "en-US";
  if (currency === "EUR") return "en-GB";
  // XLM (or any unrecognised value): let the device pick.
  return undefined;
}
