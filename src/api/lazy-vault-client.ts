// @CONTEXT: `@stellar/stellar-sdk` pulls Buffer/XDR/crypto bindings at module-init time, and statically importing it from the SessionProvider blocks the whole JS bundle from booting on Hermes (first screen never paints). A prior toggle-gated import fixed boot but caused a failed-chunk-load retry loop when flipped at runtime. This proxy instead keeps stellar-sdk out of the cold-start chunk, lazily loads the real Soroban client on the first vault method call (never from the render path, so load failures can't cascade into a re-render loop), de-dupes concurrent loads via a singleton promise, and always routes writes to Soroban (the REST mirror was removed because it let users bypass the on-chain time-lock).

import type {
  CreateVaultInput,
  IVaultClient,
  Summary,
  Transaction as VaultTransaction,
  Vault,
} from "@/src/vault/contract";

let _sorobanPromise: Promise<IVaultClient> | null = null;

function loadSoroban(): Promise<IVaultClient> {
  if (!_sorobanPromise) {
    _sorobanPromise = import("@/src/api/soroban-client").then(
      (mod) => mod.sorobanVaultClient,
    );
  }
  return _sorobanPromise;
}

export const lazyVaultClient: IVaultClient = {
  kind: "soroban",
  async registerWallet(pk: string): Promise<{ public_key: string }> {
    const c = await loadSoroban();
    return c.registerWallet(pk);
  },
  async summary(pk: string): Promise<Summary> {
    const c = await loadSoroban();
    return c.summary(pk);
  },
  async listVaults(owner: string, beneficiary?: string): Promise<Vault[]> {
    const c = await loadSoroban();
    return c.listVaults(owner, beneficiary);
  },
  async getVault(id: string, ownerHint?: string): Promise<Vault> {
    const c = await loadSoroban();
    return c.getVault(id, ownerHint);
  },
  async createVault(input: CreateVaultInput): Promise<Vault> {
    const c = await loadSoroban();
    return c.createVault(input);
  },
  async deposit(id: string, owner: string, amount: number): Promise<Vault> {
    const c = await loadSoroban();
    return c.deposit(id, owner, amount);
  },
  async extendLock(id: string, owner: string, seconds: number): Promise<Vault> {
    const c = await loadSoroban();
    return c.extendLock(id, owner, seconds);
  },
  async withdraw(id: string, owner: string): Promise<Vault> {
    const c = await loadSoroban();
    return c.withdraw(id, owner);
  },
  async vaultTransactions(id: string): Promise<VaultTransaction[]> {
    const c = await loadSoroban();
    return c.vaultTransactions(id);
  },
  async allTransactions(owner: string): Promise<VaultTransaction[]> {
    const c = await loadSoroban();
    return c.allTransactions(owner);
  },
};
