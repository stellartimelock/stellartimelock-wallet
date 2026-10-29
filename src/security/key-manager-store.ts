// Key Manager store.
//
// JSON list of manually saved key entries. Supports Stellar and other
// chains (SOL, BTC, ETH/EVM, custom). Persisted in AsyncStorage.
// The whole list is encrypted with the wallet seed (the same scheme as a
// .stvault backup) before it is written. Older plaintext lists are
// encrypted on the next unlocked read. A new phone with that seed opens it.
//
// Schema v1 (Stellar-only, pre-1.6.2):
//   { id, label, secretSeed, publicAddress, seedPhrase?, notes?, createdAt, updatedAt? }
// Schema v2 (1.6.2+, multi-chain):
//   Adds chain, watchOnly. secretSeed is the private key for any chain.
//   Backward-compat: entries without `chain` field are treated as Stellar.

import { storage } from "@/src/utils/storage";
import { isValidStellarAddress } from "@/src/wallet/address-book";
import {
  InvalidSecretSeedError,
  keypairFromSecretSeed,
} from "@/src/wallet/stellar";
import { looksLikeMnemonic, normalizeMnemonic } from "@/src/wallet/seed-phrase";
import {
  type KeyChain,
  isValidKeyForChain,
  deriveAddressForChain,
} from "@/src/security/key-chain-utils";

const KEY_MANAGER_KEY = "xlm_vault_key_manager_v1";

/** Stellar S... secret seed — 56 chars Base32, no 0/1/8/I/L. */
const STELLAR_S_REGEX = /^S[A-Z2-7]{55}$/;

export interface KeyManagerEntry {
  id: string;
  label: string;
  /**
   * Chain the key belongs to. Defaults to 'stellar' when absent (backward compat).
   * 'stellar' | 'sol' | 'btc' | 'eth' | 'other'
   */
  chain?: KeyChain;
  /**
   * Watch-only entry — public address saved without a private key.
   * When true, secretSeed is empty and balance is fetched read-only.
   */
  watchOnly?: boolean;
  /**
   * Private key / secret seed. For Stellar: S… (56 chars). For other chains:
   * chain-specific format. Empty string for watch-only entries.
   */
  secretSeed: string;
  /** Public address. Auto-derived for Stellar and SOL; manually entered for BTC/ETH. */
  publicAddress: string;
  /** Optional BIP-39 recovery phrase (12 or 24 words). */
  seedPhrase?: string;
  /** Free-form notes. */
  notes?: string;
  createdAt: number;
  /** Set on every write; used for LWW backup merge. */
  updatedAt?: number;
}

/** Effective chain for an entry (handles missing field from old entries). */
export function entryChain(e: KeyManagerEntry): KeyChain {
  return e.chain ?? "stellar";
}

let writeLock: Promise<void> | null = null;
let releaseLock: (() => void) | null = null;

/** In-memory copy of the last opened save. Later Home focuses skip the KDF. */
let sessionCache: { raw: string; entries: KeyManagerEntry[] } | null = null;
/** Bumped on every write so an in-flight open cannot cache a stale file. */
let sessionGeneration = 0;
let readInflight: { raw: string; promise: Promise<KeyManagerEntry[]> } | null = null;

type UpdatingListener = (updating: boolean) => void;
const updatingListeners = new Set<UpdatingListener>();
let updatingDepth = 0;

export function subscribeKeyManagerUpdating(listener: UpdatingListener): () => void {
  updatingListeners.add(listener);
  listener(updatingDepth > 0);
  return () => {
    updatingListeners.delete(listener);
  };
}

function setKeyManagerUpdating(next: boolean): void {
  const was = updatingDepth > 0;
  updatingDepth += next ? 1 : -1;
  if (updatingDepth < 0) updatingDepth = 0;
  const now = updatingDepth > 0;
  if (was === now) return;
  for (const listener of updatingListeners) listener(now);
}

function cloneEntries(entries: KeyManagerEntry[]): KeyManagerEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

async function acquireWriteLock(): Promise<void> {
  while (writeLock) {
    await writeLock;
  }
  writeLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
}

function releaseWriteLock(): void {
  const r = releaseLock;
  writeLock = null;
  releaseLock = null;
  r?.();
}

export function isValidSecretSeed(s: string): boolean {
  const clean = (s ?? "").trim().toUpperCase();
  if (!STELLAR_S_REGEX.test(clean)) return false;
  try {
    keypairFromSecretSeed(clean);
    return true;
  } catch {
    return false;
  }
}

export function isValidPublicAddress(s: string): boolean {
  return isValidStellarAddress(s);
}

/** Validate a private key for the given chain (falls back to Stellar check when unset). */
export function isValidPrivateKeyForChain(chain: KeyChain | undefined, key: string): boolean {
  const c = chain ?? "stellar";
  if (c === "stellar") return isValidSecretSeed(key);
  return isValidKeyForChain(c, key);
}

/**
 * Validate a public address for the given chain.
 * Stellar requires a G… address; other chains accept any non-empty string.
 */
export function isValidAddressForChain(chain: KeyChain | undefined, addr: string): boolean {
  const c = chain ?? "stellar";
  if (c === "stellar") return isValidStellarAddress(addr);
  return addr.trim().length > 0;
}

/** True when empty (optional) or a 12/24-word phrase shape. */
export function isValidOptionalSeedPhrase(s: string | undefined | null): boolean {
  const trimmed = (s ?? "").trim();
  if (!trimmed) return true;
  return looksLikeMnemonic(trimmed);
}

/** Derive G… from S… (Stellar); returns null when the seed is invalid. */
export function derivePublicAddress(secretSeed: string): string | null {
  try {
    return keypairFromSecretSeed(secretSeed).publicKey;
  } catch {
    return null;
  }
}

/**
 * Derive the public address for ANY chain from the private key.
 * Returns null when derivation isn't possible (e.g. BTC/ETH without keccak/RIPEMD).
 */
export function derivePublicAddressForChain(
  chain: KeyChain | undefined,
  privateKey: string,
): string | null {
  const c = chain ?? "stellar";
  if (c === "stellar") return derivePublicAddress(privateKey);
  return deriveAddressForChain(c, privateKey);
}

async function walletSeed(): Promise<string | null> {
  const { unlockedWalletSeed } = await import("@/src/security/session-keystore");
  return unlockedWalletSeed();
}

async function randomBytes(): Promise<Uint8Array> {
  const Crypto = await import("expo-crypto");
  return Crypto.getRandomBytesAsync(16);
}

async function readAll(): Promise<KeyManagerEntry[]> {
  const raw = (await storage.getItem<string>(KEY_MANAGER_KEY, "")) ?? "";
  if (sessionCache && sessionCache.raw === raw) {
    return cloneEntries(sessionCache.entries);
  }
  if (readInflight && readInflight.raw === raw) {
    const entries = await readInflight.promise;
    return cloneEntries(entries);
  }
  const started = sessionGeneration;
  const promise = readAllUncached(raw, started);
  readInflight = { raw, promise };
  try {
    return await promise;
  } finally {
    if (readInflight?.promise === promise) readInflight = null;
  }
}

async function readAllUncached(raw: string, started: number): Promise<KeyManagerEntry[]> {
  const { runKeyManagerMigration } = await import("@/src/security/key-manager-at-rest");
  const file = await import("@/src/security/key-manager-file");
  const seed = await walletSeed();
  const needsKdf = Boolean(seed) && raw.trim().length > 0;
  if (needsKdf) {
    setKeyManagerUpdating(true);
    // Let the first paint and the Horizon price request start before the KDF.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  try {
    const result = await runKeyManagerMigration(
      {
        readLive: async () => (await storage.getItem<string>(KEY_MANAGER_KEY, "")) ?? "",
        writeLive: async (payload) => {
          await file.saveKeyManagerPayload(payload, { confirmShrink: true });
          const saved = await storage.setItem(KEY_MANAGER_KEY, payload);
          if (!saved) throw new Error("Unable to save key manager entries.");
        },
        backupPlaintext: (json) => file.backupKeyManagerPlaintext(json),
        removeBackup: () => file.removeVerifiedPlaintextBackups(),
      },
      seed,
      randomBytes,
    );
    const entries = result.entries as KeyManagerEntry[];
    if (result.verified && started === sessionGeneration) {
      const stored = (await storage.getItem<string>(KEY_MANAGER_KEY, "")) ?? "";
      if (started === sessionGeneration) {
        sessionCache = { raw: stored, entries: cloneEntries(entries) };
      }
    }
    return cloneEntries(entries);
  } finally {
    if (needsKdf) setKeyManagerUpdating(false);
  }
}

async function writeAll(
  entries: KeyManagerEntry[],
  opts?: { confirmShrink?: boolean },
): Promise<void> {
  const { sealKeyManagerPayloadAsync } = await import("@/src/security/key-manager-at-rest");
  const seed = await walletSeed();
  if (!seed) throw new Error("Unlock the wallet before saving a key.");
  sessionGeneration += 1;
  sessionCache = null;
  setKeyManagerUpdating(true);
  let payload = "";
  try {
    payload = await sealKeyManagerPayloadAsync(
      entries,
      seed,
      await randomBytes(),
      await randomBytes(),
    );
  } finally {
    setKeyManagerUpdating(false);
  }
  const { saveKeyManagerPayload } = await import("@/src/security/key-manager-file");
  await saveKeyManagerPayload(payload, opts);
  const saved = await storage.setItem(KEY_MANAGER_KEY, payload);
  if (!saved) throw new Error("Unable to save key manager entries.");
  sessionCache = { raw: payload, entries: cloneEntries(entries) };
}

function newId(): string {
  return `km_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Public address only. The secret seed and recovery phrase stay in the store. */
export interface KeyManagerPublicAddress {
  id: string;
  label: string;
  publicAddress: string;
  chain: KeyChain;
}

function toPublicAddresses(entries: KeyManagerEntry[]): KeyManagerPublicAddress[] {
  const out: KeyManagerPublicAddress[] = [];
  for (const entry of entries) {
    const publicAddress = (entry.publicAddress ?? "").trim();
    if (!publicAddress) continue;
    out.push({
      id: entry.id,
      label: (entry.label ?? "").trim() || "Saved key",
      publicAddress,
      chain: entryChain(entry),
    });
  }
  return out;
}

/** The opened Key Manager list, if this session already has it. No disk read. */
export function hasKeyManagerSessionCache(): boolean {
  return sessionCache != null;
}

/** Public addresses from the in-memory list. Empty when the list is not open yet. */
export function peekKeyManagerPublicAddresses(): KeyManagerPublicAddress[] {
  if (!sessionCache) return [];
  return toPublicAddresses(sessionCache.entries);
}

/**
 * Public addresses only. Uses the session list when Home already opened
 * Key Manager. Otherwise the same yielding open as 1.6.6, then drops secrets
 * before returning.
 */
export async function listKeyPublicAddresses(): Promise<KeyManagerPublicAddress[]> {
  if (sessionCache) return toPublicAddresses(sessionCache.entries);
  return toPublicAddresses(await listKeyEntries());
}

export async function listKeyEntries(): Promise<KeyManagerEntry[]> {
  const all = await readAll();
  return all
    .filter(
      (e) =>
        e &&
        typeof e.publicAddress === "string" &&
        // Backward compat: secretSeed may be empty for watch-only entries
        (typeof e.secretSeed === "string" || e.watchOnly),
    )
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export async function upsertKeyEntry(
  input: {
    id?: string;
    label: string;
    chain?: KeyChain;
    watchOnly?: boolean;
    secretSeed: string;
    publicAddress?: string;
    seedPhrase?: string;
    notes?: string;
  },
  opts?: { confirmShrink?: boolean },
): Promise<KeyManagerEntry> {
  const label = (input.label ?? "").trim();
  if (!label) throw new Error("Label is required.");
  if (label.length > 48) throw new Error("Label must be 48 characters or fewer.");

  const chain: KeyChain = input.chain ?? "stellar";
  const watchOnly = input.watchOnly ?? false;

  // Validate private key (skip for watch-only entries)
  let secretSeed: string;
  let derived: string | null = null;

  if (watchOnly) {
    secretSeed = "";
  } else if (chain === "stellar") {
    secretSeed = (input.secretSeed ?? "").trim().toUpperCase();
    if (!STELLAR_S_REGEX.test(secretSeed)) {
      throw new Error("Secret seed must be a valid 56-character Stellar S… key.");
    }
    try {
      derived = keypairFromSecretSeed(secretSeed).publicKey;
    } catch (e) {
      if (e instanceof InvalidSecretSeedError) {
        throw new Error(e.message);
      }
      throw new Error("Secret seed is not a valid Stellar S… key.");
    }
  } else {
    secretSeed = (input.secretSeed ?? "").trim();
    if (secretSeed && !isValidKeyForChain(chain, secretSeed)) {
      throw new Error(`Private key is not valid for ${chain}.`);
    }
    derived = deriveAddressForChain(chain, secretSeed);
  }

  // Validate / resolve public address
  let publicAddress = (input.publicAddress ?? "").trim();
  if (chain === "stellar") publicAddress = publicAddress.toUpperCase();

  if (!publicAddress && derived) {
    publicAddress = derived;
  }
  if (!watchOnly && !publicAddress && !derived) {
    throw new Error("Public address is required when address cannot be auto-derived.");
  }

  if (chain === "stellar" && !isValidPublicAddress(publicAddress)) {
    throw new Error("Public address must be a valid 56-character Stellar G… address.");
  }
  if (chain !== "stellar" && !watchOnly && publicAddress.trim().length === 0) {
    throw new Error("Public address is required.");
  }

  // Stellar: prefer derived address to prevent mismatched pairs.
  if (chain === "stellar" && derived && publicAddress !== derived) {
    publicAddress = derived;
  }

  const phraseRaw = (input.seedPhrase ?? "").trim();
  if (phraseRaw && !looksLikeMnemonic(phraseRaw)) {
    throw new Error("Seed phrase must be 12 or 24 words.");
  }
  const seedPhrase = phraseRaw ? normalizeMnemonic(phraseRaw) : undefined;
  const notes = (input.notes ?? "").trim() || undefined;

  let saved: KeyManagerEntry;
  await acquireWriteLock();
  try {
    const all = await readAll();
    const now = Date.now();
    if (input.id) {
      const idx = all.findIndex((e) => e.id === input.id);
      if (idx >= 0) {
        const updated: KeyManagerEntry = {
          ...all[idx],
          label,
          chain,
          watchOnly: watchOnly || undefined,
          secretSeed,
          publicAddress,
          seedPhrase,
          notes,
          updatedAt: now,
        };
        all[idx] = updated;
        await writeAll(all, opts);
        saved = updated;
      } else {
        const created: KeyManagerEntry = {
          id: input.id,
          label,
          chain,
          watchOnly: watchOnly || undefined,
          secretSeed,
          publicAddress,
          seedPhrase,
          notes,
          createdAt: now,
          updatedAt: now,
        };
        await writeAll([created, ...all], opts);
        saved = created;
      }
    } else {
      const created: KeyManagerEntry = {
        id: newId(),
        label,
        chain,
        watchOnly: watchOnly || undefined,
        secretSeed,
        publicAddress,
        seedPhrase,
        notes,
        createdAt: now,
        updatedAt: now,
      };
      await writeAll([created, ...all], opts);
      saved = created;
    }
  } finally {
    releaseWriteLock();
  }

  // Mirror onto wallet-book AFTER releasing the KM lock (renameWallet may
  // call back into syncKeyManagerLabelForPublicKey).
  await mirrorLabelToWalletBook(saved.publicAddress, saved.label);
  return saved;
}

/** After a Key Manager label write, mirror onto the wallet book when the
 *  public key matches a signing wallet. Dynamic import avoids a cycle. */
async function mirrorLabelToWalletBook(
  publicAddress: string,
  label: string,
): Promise<void> {
  try {
    const { renameWalletByPublicKey } = await import("@/src/wallet/wallet-book");
    await renameWalletByPublicKey(publicAddress, label);
  } catch {
    /* non-fatal */
  }
}

export async function removeKeyEntry(
  id: string,
  opts?: { confirmShrink?: boolean },
): Promise<void> {
  await acquireWriteLock();
  try {
    const all = await readAll();
    await writeAll(
      all.filter((e) => e.id !== id),
      opts,
    );
  } finally {
    releaseWriteLock();
  }
}

/**
 * Mirror a wallet-book nickname onto any Key Manager entry with the
 * same public address. No-op when no entry matches or the label is
 * already identical. Does not call back into wallet-book (avoids loops).
 */
export async function syncKeyManagerLabelForPublicKey(
  publicKey: string,
  label: string,
): Promise<void> {
  const pk = (publicKey || "").trim().toUpperCase();
  const nextLabel = (label || "").trim();
  if (!pk || !nextLabel) return;

  await acquireWriteLock();
  try {
    const all = await readAll();
    let changed = false;
    const now = Date.now();
    for (let i = 0; i < all.length; i++) {
      const e = all[i];
      if (!e) continue;
      if ((e.publicAddress || "").toUpperCase() !== pk) continue;
      if (e.label === nextLabel) continue;
      all[i] = { ...e, label: nextLabel, updatedAt: now };
      changed = true;
    }
    if (changed) await writeAll(all);
  } finally {
    releaseWriteLock();
  }
}

/**
 * Find a Key Manager entry by public address, if any.
 */
export async function findKeyEntryByPublicAddress(
  publicKey: string,
): Promise<KeyManagerEntry | null> {
  const pk = (publicKey || "").trim().toUpperCase();
  if (!pk) return null;
  const all = await readAll();
  return all.find((e) => (e.publicAddress || "").toUpperCase() === pk) ?? null;
}
