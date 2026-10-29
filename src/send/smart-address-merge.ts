// Merge contacts, wallets, Key Manager public addresses, and vault
// counterparties. Same address once. No secrets and no phone contacts.

export type SmartAddressSource = "contact" | "wallet" | "key" | "vault";
export type SmartAddressKind = "private" | "exchange" | "casino" | "donation";

export interface SmartAddress {
  id: string;
  label: string;
  publicKey: string;
  defaultMemo: string;
  kind: SmartAddressKind;
  source: SmartAddressSource;
  icon?: string;
}

export interface NamedPublicAddress {
  id: string;
  label: string;
  publicKey: string;
}

export interface SmartContactInput {
  id: string;
  label: string;
  publicKey: string;
  defaultMemo?: string;
  kind?: SmartAddressKind;
  icon?: string;
}

export interface SmartWalletInput {
  id: string;
  label: string;
  publicKey: string;
}

export interface SmartKeyInput {
  id: string;
  label: string;
  publicAddress: string;
  chain?: string;
}

const SOURCE_RANK: Record<SmartAddressSource, number> = {
  contact: 0,
  wallet: 1,
  key: 2,
  vault: 3,
};

const STELLAR_G = /^G[A-Z2-7]{55}$/;

function addressKey(publicKey: string): string {
  const trimmed = publicKey.trim();
  return STELLAR_G.test(trimmed.toUpperCase()) ? trimmed.toUpperCase() : trimmed;
}

export function mergeSmartAddresses(input: {
  contacts: SmartContactInput[];
  wallets: SmartWalletInput[];
  keys: SmartKeyInput[];
  vaults: NamedPublicAddress[];
}): SmartAddress[] {
  const byAddress = new Map<string, SmartAddress>();
  const keep = (row: SmartAddress) => {
    const key = addressKey(row.publicKey);
    if (!key) return;
    const existing = byAddress.get(key);
    if (!existing || SOURCE_RANK[row.source] < SOURCE_RANK[existing.source]) {
      byAddress.set(key, { ...row, publicKey: key.startsWith("G") ? key : row.publicKey.trim() });
    }
  };

  for (const contact of input.contacts) {
    if (!contact?.publicKey) continue;
    keep({
      id: contact.id,
      label: contact.label || "Saved contact",
      publicKey: contact.publicKey,
      defaultMemo: contact.defaultMemo ?? "",
      kind: contact.kind ?? "private",
      source: "contact",
      icon: contact.icon,
    });
  }
  for (const wallet of input.wallets) {
    const publicKey = (wallet.publicKey ?? "").trim();
    if (!STELLAR_G.test(publicKey.toUpperCase())) continue;
    keep({
      id: wallet.id,
      label: wallet.label || "Wallet",
      publicKey,
      defaultMemo: "",
      kind: "private",
      source: "wallet",
    });
  }
  for (const key of input.keys) {
    if (key.chain && key.chain !== "stellar") continue;
    const publicKey = (key.publicAddress ?? "").trim();
    if (!STELLAR_G.test(publicKey.toUpperCase())) continue;
    keep({
      id: key.id,
      label: key.label || "Saved key",
      publicKey,
      defaultMemo: "",
      kind: "private",
      source: "key",
    });
  }
  for (const vault of input.vaults) {
    const publicKey = (vault.publicKey ?? "").trim();
    if (!STELLAR_G.test(publicKey.toUpperCase())) continue;
    keep({
      id: vault.id,
      label: vault.label || "Vault",
      publicKey,
      defaultMemo: "",
      kind: "private",
      source: "vault",
    });
  }
  return [...byAddress.values()];
}
