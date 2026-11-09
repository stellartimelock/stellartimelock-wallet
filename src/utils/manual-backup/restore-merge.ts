// In-memory restore of a backup envelope.
// One list goes to disk after the merge, so a large file is not written
// once per contact. Older files that omit `v` are treated as v1 when
// they still carry wallet data. No storage and no React Native.

export interface RestoreAddress {
  id: string;
  label: string;
  publicKey: string;
  defaultMemo: string;
  kind: string;
  network?: "stellar" | "solana";
  icon?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface RestoreTotp {
  id: string;
  name: string;
  issuer?: string;
  secret: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RestoreKey {
  id: string;
  label: string;
  chain?: string;
  watchOnly?: boolean;
  secretSeed: string;
  publicAddress: string;
  seedPhrase?: string;
  notes?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface RestoreWallet {
  id: string;
  label: string;
  publicKey: string;
  kind?: string;
  createdAt: number;
  updatedAt?: number;
}

const STELLAR_G = /^G[A-Z2-7]{55}$/;
const STELLAR_S = /^S[A-Z2-7]{55}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function stamp(updatedAt?: number, createdAt?: number): number {
  return updatedAt ?? createdAt ?? 0;
}

function memoBytes(value: string): number {
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length;
  }
}

/**
 * Envelope version to store. Numeric 1–8 stays. A string "1"–"8" is
 * accepted. An older file that omitted `v` but still has wallet fields
 * is treated as v1. Anything else with no wallet fields is rejected.
 */
export function coercedEnvelopeVersion(v: unknown, hasWalletFields: boolean): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null {
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5 || v === 6 || v === 7 || v === 8) {
    return v;
  }
  if (typeof v === "string" && /^[1-8]$/.test(v)) {
    return Number(v) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  }
  if (hasWalletFields) return 1;
  return null;
}

export function envelopeHasWalletFields(env: {
  addresses?: unknown;
  totp?: unknown;
  keyManager?: unknown;
  walletMeta?: unknown;
  notes?: unknown;
  bills?: unknown;
}): boolean {
  return (
    Array.isArray(env.addresses) ||
    Array.isArray(env.totp) ||
    Array.isArray(env.keyManager) ||
    Array.isArray(env.walletMeta) ||
    Array.isArray(env.notes) ||
    Array.isArray(env.bills)
  );
}

/**
 * `null` means this section was not in the file: leave the phone alone.
 * An array, even empty, replaces the local list.
 */
export function mergeRestoredAddresses(
  local: RestoreAddress[],
  remote: RestoreAddress[] | undefined,
): RestoreAddress[] | null {
  if (!Array.isArray(remote)) return null;
  const byId = new Map(local.map((row) => [row.id, { ...row }]));
  const remoteIds = new Set<string>();
  for (const raw of remote) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue;
    remoteIds.add(raw.id);
    const publicKey = (raw.publicKey ?? "").trim();
    let network = raw.network;
    if (network !== "solana" && network !== "stellar") {
      network = SOLANA.test(publicKey) && !STELLAR_G.test(publicKey) ? "solana" : "stellar";
    }
    const memo = network === "solana" ? "" : (raw.defaultMemo ?? "").trim();
    const addressOk = network === "solana" ? SOLANA.test(publicKey) : STELLAR_G.test(publicKey);
    if (!addressOk) continue;
    if (network === "stellar" && memoBytes(memo) > 28) continue;
    if (
      network === "stellar" &&
      (raw.kind === "exchange" || raw.kind === "casino") &&
      memo.length === 0
    ) {
      continue;
    }
    const label = (raw.label ?? "").trim();
    if (!label || label.length > 32) continue;
    const current = byId.get(raw.id);
    const remoteTs = stamp(raw.updatedAt, raw.createdAt);
    if (current && remoteTs <= stamp(current.updatedAt, current.createdAt)) continue;
    byId.set(raw.id, {
      id: raw.id,
      label,
      publicKey,
      defaultMemo: memo,
      kind: raw.kind || "private",
      network,
      icon: raw.icon,
      createdAt: current?.createdAt ?? raw.createdAt ?? 0,
      updatedAt: raw.updatedAt ?? raw.createdAt ?? remoteTs,
    });
  }
  for (const id of [...byId.keys()]) {
    if (!remoteIds.has(id)) byId.delete(id);
  }
  return [...byId.values()];
}

export function mergeRestoredTotp(
  local: RestoreTotp[],
  remote: RestoreTotp[] | undefined,
): RestoreTotp[] | null {
  if (!Array.isArray(remote)) return null;
  const byId = new Map(local.map((row) => [row.id, { ...row }]));
  const remoteIds = new Set<string>();
  for (const raw of remote) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue;
    remoteIds.add(raw.id);
    const secret = (raw.secret ?? "").replace(/\s+/g, "").toUpperCase();
    const name = (raw.name ?? "").trim();
    if (!secret || !name) continue;
    const current = byId.get(raw.id);
    const remoteTs = stamp(raw.updatedAt, raw.createdAt);
    if (current && remoteTs <= stamp(current.updatedAt, current.createdAt)) continue;
    byId.set(raw.id, {
      id: raw.id,
      name,
      issuer: raw.issuer?.trim() || undefined,
      secret,
      isDefault: raw.isDefault === true,
      createdAt: current?.createdAt ?? raw.createdAt ?? 0,
      updatedAt: raw.updatedAt ?? raw.createdAt ?? remoteTs,
    });
  }
  for (const id of [...byId.keys()]) {
    if (!remoteIds.has(id)) byId.delete(id);
  }
  return [...byId.values()];
}

export function mergeRestoredKeys(
  local: RestoreKey[],
  remote: RestoreKey[] | undefined,
): RestoreKey[] | null {
  if (!Array.isArray(remote)) return null;
  const byId = new Map(local.map((row) => [row.id, { ...row }]));
  const remoteIds = new Set<string>();
  for (const raw of remote) {
    if (!raw || typeof raw.id !== "string" || !raw.id) continue;
    remoteIds.add(raw.id);
    const chain = raw.chain || "stellar";
    const watchOnly = raw.watchOnly === true;
    const publicAddress = (raw.publicAddress ?? "").trim();
    const secretSeed = chain === "stellar" ? (raw.secretSeed ?? "").trim().toUpperCase() : (raw.secretSeed ?? "").trim();
    if (!publicAddress) continue;
    if (chain === "stellar" && !STELLAR_G.test(publicAddress.toUpperCase())) continue;
    if (chain === "stellar" && !watchOnly && !STELLAR_S.test(secretSeed)) continue;
    const label = (raw.label ?? "").trim();
    if (!label || label.length > 48) continue;
    const current = byId.get(raw.id);
    const remoteTs = stamp(raw.updatedAt, raw.createdAt);
    if (current && remoteTs <= stamp(current.updatedAt, current.createdAt)) continue;
    byId.set(raw.id, {
      ...current,
      id: raw.id,
      label,
      chain,
      watchOnly: watchOnly || undefined,
      secretSeed: watchOnly ? "" : secretSeed,
      publicAddress: chain === "stellar" ? publicAddress.toUpperCase() : publicAddress,
      seedPhrase: raw.seedPhrase,
      notes: raw.notes,
      createdAt: current?.createdAt ?? raw.createdAt ?? 0,
      updatedAt: raw.updatedAt ?? raw.createdAt ?? remoteTs,
    });
  }
  for (const id of [...byId.keys()]) {
    if (!remoteIds.has(id)) byId.delete(id);
  }
  return [...byId.values()];
}

/** Copy newer wallet nicknames onto saved keys that share a public address. */
export function applyWalletLabelsToKeys<K extends RestoreKey>(keys: K[], wallets: RestoreWallet[]): K[] {
  const byPub = new Map(wallets.map((row) => [row.publicKey.toUpperCase(), row]));
  return keys.map((key) => {
    const wallet = byPub.get(key.publicAddress.toUpperCase());
    if (!wallet?.label || wallet.label === key.label) return key;
    const walletTs = stamp(wallet.updatedAt, wallet.createdAt);
    const keyTs = stamp(key.updatedAt, key.createdAt);
    if (walletTs < keyTs) return key;
    return { ...key, label: wallet.label, updatedAt: Math.max(walletTs, keyTs) };
  });
}

/**
 * Put every wallet from the backup into the Key Manager list.
 * A matching saved key keeps its secret and picks up the newer nickname.
 * A wallet with no saved key is added: signing if `secretsByPublicKey`
 * has its S… seed (usually still on the phone), otherwise watch-only.
 * The backup file itself does not carry wallet-book seeds.
 */
export function keysFromRestoredWallets(
  keys: RestoreKey[],
  wallets: RestoreWallet[] | undefined,
  secretsByPublicKey: Record<string, string> = {},
): RestoreKey[] {
  if (!Array.isArray(wallets) || wallets.length === 0) return keys;
  const labeled = applyWalletLabelsToKeys(keys, wallets);
  const have = new Set(labeled.map((key) => key.publicAddress.toUpperCase()));
  const extra: RestoreKey[] = [];
  for (const wallet of wallets) {
    const publicAddress = (wallet.publicKey ?? "").trim().toUpperCase();
    if (!STELLAR_G.test(publicAddress) || have.has(publicAddress)) continue;
    const label = (wallet.label ?? "").trim().slice(0, 48);
    if (!label) continue;
    const secret = (secretsByPublicKey[publicAddress] ?? "").trim().toUpperCase();
    const canSign = STELLAR_S.test(secret);
    extra.push({
      id: `km_wallet_${wallet.id || publicAddress}`,
      label,
      chain: "stellar",
      watchOnly: canSign ? undefined : true,
      secretSeed: canSign ? secret : "",
      publicAddress,
      createdAt: wallet.createdAt ?? 0,
      updatedAt: wallet.updatedAt ?? wallet.createdAt ?? 0,
    });
    have.add(publicAddress);
  }
  return extra.length ? [...labeled, ...extra] : labeled;
}
