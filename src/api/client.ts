// @CONTEXT: REST vault client talks to the FastAPI + MongoDB backend that mirrors the Soroban contract rules 1:1

import type {
  CreateVaultInput,
  IVaultClient,
  Summary,
  Transaction,
  Vault,
} from "@/src/vault/contract";
import { lazyVaultClient } from "@/src/api/lazy-vault-client";

async function request<T>(_path: string, _init?: RequestInit): Promise<T> {
  void _path;
  void _init;
  throw new Error("Vault data is read from the Stellar network.");
}

class RestVaultClient implements IVaultClient {
  readonly kind = "rest" as const;

  registerWallet(publicKey: string) {
    return request<{ public_key: string; created_at: string }>("/wallets/register", {
      method: "POST",
      body: JSON.stringify({ public_key: publicKey }),
    });
  }
  summary(publicKey: string) {
    return request<Summary>(`/wallets/${publicKey}/summary`);
  }
  listVaults(owner: string, beneficiary?: string) {
    const params = `owner=${owner}${beneficiary ? `&beneficiary=${beneficiary}` : ""}`;
    return request<Vault[]>(`/vaults?${params}`);
  }
  getVault(id: string, _ownerHint?: string) {
    return request<Vault>(`/vaults/${id}`);
  }
  createVault(input: CreateVaultInput) {
    return request<Vault>("/vaults", { method: "POST", body: JSON.stringify(input) });
  }
  deposit(id: string, owner_public_key: string, amount: number) {
    return request<Vault>(`/vaults/${id}/deposit`, {
      method: "POST",
      body: JSON.stringify({ owner_public_key, amount }),
    });
  }
  extendLock(id: string, owner_public_key: string, additional_seconds: number) {
    return request<Vault>(`/vaults/${id}/extend`, {
      method: "POST",
      body: JSON.stringify({ owner_public_key, additional_seconds }),
    });
  }
  withdraw(id: string, owner_public_key: string) {
    return request<Vault>(`/vaults/${id}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ owner_public_key }),
    });
  }
  vaultTransactions(id: string) {
    return request<Transaction[]>(`/vaults/${id}/transactions`);
  }
  allTransactions(owner: string) {
    return request<Transaction[]>(`/transactions?owner=${owner}`);
  }
}

export const restVaultClient: IVaultClient = new RestVaultClient();

// @CONTEXT: mutable so the Settings → "Use on-chain Soroban" toggle can swap implementations at runtime without screens having to subscribe; defaults to the REST mirror, SessionProvider replaces it once the toggle is on and the Soroban module has finished lazy-loading
let activeClient: IVaultClient = lazyVaultClient;
export function setActiveVaultClient(c: IVaultClient): void {
  activeClient = c;
}
export function getActiveVaultClient(): IVaultClient {
  return activeClient;
}

export const api = {
  registerWallet: (pk: string) => activeClient.registerWallet(pk),
  summary: (pk: string) => activeClient.summary(pk),
  listVaults: (owner: string, beneficiary?: string) => activeClient.listVaults(owner, beneficiary),
  getVault: (id: string, ownerHint?: string) => activeClient.getVault(id, ownerHint),
  createVault: (body: CreateVaultInput) => activeClient.createVault(body),
  deposit: (id: string, owner: string, amount: number) =>
    activeClient.deposit(id, owner, amount),
  extend: (id: string, owner: string, seconds: number) =>
    activeClient.extendLock(id, owner, seconds),
  withdraw: (id: string, owner: string) => activeClient.withdraw(id, owner),
  vaultTransactions: (id: string) => activeClient.vaultTransactions(id),
  allTransactions: (owner: string) => activeClient.allTransactions(owner),
  fetchMarketPrice: fetchMarketPrice,
};

// @CONTEXT: market data historically proxied through /market/xlm-price (Horizon DEX mid + ECB EUR). The mobile session now queries the Stellar DEX orderbook directly via fetchXlmDexPrice() in horizon.ts — this helper remains for any leftover backend callers / diagnostics.
export interface MarketPrice {
  xlm: { usd: number; eur: number; last_updated_at: number };
  // @CONTEXT: accepts the new canonical source label plus a back-compat alias for the historic CoinGecko cache value; the dashboard never branches on this field, it's purely informational
  source: "stellar_horizon_ecb" | "coingecko" | string;
  cached: boolean;
  age_seconds: number;
}

export async function fetchMarketPrice(): Promise<MarketPrice> {
  return request<MarketPrice>("/market/xlm-price");
}

export type { Vault, Transaction, Summary } from "@/src/vault/contract";
