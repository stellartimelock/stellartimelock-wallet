// On-device request parser. No network, no model download, no cloud.
// A match is a plan or a local bill lookup — never a signed transaction.

export type MoneyCurrency = "USD" | "XLM";

export interface MoneyAmount {
  value: string;
  currency: MoneyCurrency;
}

export type ParsedRequest =
  | { intent: "bills_due"; window: "week" }
  | { intent: "top_up_card"; amount: MoneyAmount | null }
  | { intent: "send"; amount: MoneyAmount; recipient: string }
  | { intent: "spend"; amount: MoneyAmount }
  | { intent: "unknown"; text: string };

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function amountFromPhrase(phrase: string, bare: MoneyCurrency): MoneyAmount | null {
  const trimmed = phrase.trim();
  const dollar = trimmed.match(/^\$\s*(\d+(?:\.\d+)?)$/);
  if (dollar) return { value: dollar[1], currency: "USD" };
  const suffixed = trimmed.match(/^(\d+(?:\.\d+)?)\s*(xlm|usd|dollars?|bucks)$/i);
  if (suffixed) {
    const word = suffixed[2].toLowerCase();
    const currency: MoneyCurrency = word === "xlm" ? "XLM" : "USD";
    return { value: suffixed[1], currency };
  }
  const bareNum = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (bareNum) return { value: bareNum[1], currency: bare };
  return null;
}

function amountInside(text: string, bare: MoneyCurrency): MoneyAmount | null {
  const dollar = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (dollar) return { value: dollar[1], currency: "USD" };
  const xlm = text.match(/(\d+(?:\.\d+)?)\s*xlm\b/i);
  if (xlm) return { value: xlm[1], currency: "XLM" };
  const usd = text.match(/(\d+(?:\.\d+)?)\s*(?:dollars?|usd|bucks)\b/i);
  if (usd) return { value: usd[1], currency: "USD" };
  const withNum = text.match(/\b(?:with|of|for)\s+(\d+(?:\.\d+)?)\b/i);
  if (withNum) return { value: withNum[1], currency: bare };
  return null;
}

export function parseRequest(text: string): ParsedRequest {
  const raw = clean(text);
  if (!raw) return { intent: "unknown", text: "" };
  const lower = raw.toLowerCase();

  if (/\bbills?\b/.test(lower) && /\b(due|week|upcoming|owe|owed)\b/.test(lower)) {
    return { intent: "bills_due", window: "week" };
  }

  if (/\b(?:top[\s-]*up|reload|refill)\b/.test(lower) && /\b(?:card|coinbase)\b/.test(lower)) {
    return { intent: "top_up_card", amount: amountInside(raw, "USD") };
  }

  const send = raw.match(/^send\s+(.+?)\s+to\s+(.+)$/i);
  if (send) {
    const amount = amountFromPhrase(send[1], "XLM");
    const recipient = send[2].trim().replace(/[?.!]+$/, "");
    if (amount && recipient) return { intent: "send", amount, recipient };
  }

  const spend = raw.match(
    /^(?:i\s+)?need\s+(.+?)\s+(?:to\s+spend|for\s+spending|spending\s+money)\b[.!?]*$/i,
  );
  if (spend) {
    const amount = amountFromPhrase(spend[1], "USD");
    if (amount) return { intent: "spend", amount };
  }

  const needDollars = raw.match(/^(?:i\s+)?need\s+(\$\s*\d+(?:\.\d+)?)[.!?]*$/i);
  if (needDollars) {
    const amount = amountFromPhrase(needDollars[1].replace(/\s+/g, ""), "USD");
    if (amount) return { intent: "spend", amount };
  }

  return { intent: "unknown", text: raw };
}
