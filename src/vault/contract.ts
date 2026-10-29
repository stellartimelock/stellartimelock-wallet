// Vault client contract — every implementation MUST implement this interface.
// Invariants mirror `/app/contracts/xlm_vault/src/lib.rs`.

export interface Vault {
  vault_id: string;
  owner_public_key: string;
  name: string;
  description: string;
  template: string;
  balance: number;
  target_amount: number | null;
  unlock_timestamp: number;
  created_timestamp: number;
  backup_address?: string | null;
  /**
   * - `locked`     : on-chain entry alive, unlock_timestamp in the future.
   * - `unlocked`   : on-chain entry alive, unlock_timestamp passed.
   * - `withdrawn`  : on-chain entry alive, balance was withdrawn.
   * - `archived`   : on-chain entry has been pruned from the ledger by
   *                  Soroban TTL expiration (or is otherwise unreachable
   *                  via the current simulate/events/cache chain). The
   *                  card is hydrated entirely from the backend meta
   *                  side-store and shows a "Wake Up" CTA that issues a
   *                  RestoreFootprint operation to bring the entry
   *                  back online. The balance / unlock_timestamp shown
   *                  for an archived vault may be stale by definition.
   */
  status: "locked" | "unlocked" | "withdrawn" | "archived";
}

export interface Transaction {
  tx_id: string;
  vault_id: string;
  owner_public_key: string;
  kind: "create" | "deposit" | "extend" | "withdraw";
  amount: number;
  note: string;
  timestamp: number;
  created_at: string;
}

export interface Summary {
  total_locked: number;
  total_unlocked: number;
  total_withdrawn: number;
  active_vaults: number;
  completed_vaults: number;
}

export interface CreateVaultInput {
  owner_public_key: string;
  name: string;
  description: string;
  template: string;
  initial_deposit: number;
  target_amount: number | null;
  unlock_timestamp: number;
  backup_address?: string | null;
}

export interface IVaultClient {
  /** Identifier of the backing implementation (used for debugging / UI badges). */
  readonly kind: "rest" | "soroban";

  registerWallet(publicKey: string): Promise<{ public_key: string }>;
  summary(publicKey: string): Promise<Summary>;
  listVaults(owner: string, beneficiary?: string): Promise<Vault[]>;
  getVault(id: string, ownerHint?: string): Promise<Vault>;
  createVault(input: CreateVaultInput): Promise<Vault>;
  deposit(id: string, owner: string, amount: number): Promise<Vault>;
  extendLock(id: string, owner: string, additionalSeconds: number): Promise<Vault>;
  withdraw(id: string, owner: string): Promise<Vault>;
  vaultTransactions(id: string): Promise<Transaction[]>;
  allTransactions(owner: string): Promise<Transaction[]>;
}
