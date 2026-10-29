import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { mergeVaults } from "../src/api/vault-merge.ts";
import type { Vault } from "../src/vault/contract.ts";

function vault(id: string, balance: number): Vault {
  return {
    vault_id: id,
    owner_public_key: "G" + "A".repeat(55),
    name: `Vault ${id}`,
    description: "",
    template: "custom",
    balance,
    target_amount: null,
    unlock_timestamp: 1_800_000_000,
    created_timestamp: 1_700_000_000,
    status: "locked",
  };
}

describe("vault list without a backend", () => {
  it("keeps a saved vault when the live read is empty", () => {
    const saved = vault("7", 12.5);
    const merged = mergeVaults([saved], []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].vault_id, "7");
    assert.equal(merged[0].balance, 12.5);
    assert.equal(merged[0].name, "Vault 7");
  });

  it("lets a fresh on-chain read replace the saved copy of the same vault", () => {
    const merged = mergeVaults([vault("7", 1)], [vault("7", 9)]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].balance, 9);
  });

  it("does not call a backend host from the vault client", () => {
    const src = readFileSync("src/api/soroban-client.ts", "utf8");
    assert.equal(src.includes("EXPO_PUBLIC_BACKEND_URL"), false);
    assert.equal(src.includes("emergent.host"), false);
    assert.equal(src.includes("mirrorMetaToBackend"), false);
    assert.match(src, /loadCachedVaults/);
    assert.match(src, /mergeVaults\(cached, simulateResult\)/);
    const client = readFileSync("src/api/client.ts", "utf8");
    assert.equal(client.includes("EXPO_PUBLIC_BACKEND_URL"), false);
    assert.match(client, /lazyVaultClient/);
  });
});
