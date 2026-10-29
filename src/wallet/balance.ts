import { storage } from "@/src/utils/storage";

const BALANCE_KEY = "xlm_vault_local_balance";
const INITIAL_BALANCE = 2500.0;

export interface WalletBalance {
  publicKey: string;
  available: number;
  source: "mock" | "horizon";
}

async function getStored(pk: string): Promise<number> {
  const v = await storage.getItem<number>(`${BALANCE_KEY}:${pk}`, INITIAL_BALANCE);
  return typeof v === "number" ? v : INITIAL_BALANCE;
}

async function setStored(pk: string, value: number): Promise<void> {
  await storage.setItem(`${BALANCE_KEY}:${pk}`, Math.max(0, Math.round(value * 10_000_000) / 10_000_000));
}

export async function fetchBalance(publicKey: string): Promise<WalletBalance> {
  const available = await getStored(publicKey);
  return { publicKey, available, source: "mock" };
}

export async function debitBalance(publicKey: string, amount: number): Promise<void> {
  const v = await getStored(publicKey);
  await setStored(publicKey, v - amount);
}

export async function creditBalance(publicKey: string, amount: number): Promise<void> {
  const v = await getStored(publicKey);
  await setStored(publicKey, v + amount);
}
