// Display currency preference. Shared by the session and the .stvault
// backup envelope (no React imports, so the envelope can read it).
import { storage } from "@/src/utils/storage";

export const CURRENCY_KEY = "xlm_vault_currency";

export type DisplayCurrency = "USD" | "EUR" | "XLM";

export function isDisplayCurrency(v: unknown): v is DisplayCurrency {
  return v === "USD" || v === "EUR" || v === "XLM";
}

export async function readDisplayCurrency(): Promise<DisplayCurrency | undefined> {
  try {
    const v = await storage.getItem<string | null>(CURRENCY_KEY, null);
    return isDisplayCurrency(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
