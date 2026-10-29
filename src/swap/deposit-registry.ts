// Persisted list of exchange deposit addresses + memos this wallet created
// swaps for. broadcastPayment() consults it so no screen can sign a
// memo-less payment to one of them.

import { storage } from "@/src/utils/storage";

import {
  type KnownDeposit,
  parseKnownDeposits,
  upsertDeposit,
} from "@/src/send/exchange-memo-gate";

export const KNOWN_DEPOSITS_KEY = "stl.swap.known_deposits.v1";

export async function loadKnownDeposits(): Promise<KnownDeposit[]> {
  try {
    const raw = await storage.getItem<string>(KNOWN_DEPOSITS_KEY, "");
    return parseKnownDeposits(raw);
  } catch {
    return [];
  }
}

export async function rememberDeposit(entry: KnownDeposit): Promise<void> {
  if (!/^G[A-Z2-7]{55}$/.test((entry.address ?? "").trim().toUpperCase())) return;
  const current = await loadKnownDeposits();
  const next = upsertDeposit(current, entry);
  await storage.setItem(KNOWN_DEPOSITS_KEY, JSON.stringify(next));
}
