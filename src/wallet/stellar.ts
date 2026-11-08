// Stellar wallet layer.
//
// Generates a real Stellar-compatible Ed25519 keypair fully on-device.
// - Random seed via expo-crypto (CSPRNG)
// - Public key derived via @noble/curves (audited, zero-dep)
// - Encoded to G... / S... using our StrKey impl (SEP-0023)
//
// SECRET KEY NEVER LEAVES THIS DEVICE.
// - Stored in SecureStore (Keychain / EncryptedSharedPreferences) via `@/src/utils/storage`.
// - Only the public key is sent to the backend.

import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";

import { decodeStrKey, isStellarPublicKey } from "./strkey";
import {
  InvalidSecretSeedError,
  keypairFromRawSeed,
  keypairFromSecretSeed,
  type StellarKeypair,
} from "./secret-seed";

export { InvalidSecretSeedError, keypairFromSecretSeed };
export type { StellarKeypair };

const SECRET_KEY = "xlm_vault_secret_seed";
const PUBLIC_KEY = "xlm_vault_public_key";

export function generateKeypairSync(): StellarKeypair {
  const seed = Crypto.getRandomBytes(32);
  return keypairFromRawSeed(seed);
}

export async function createAndPersistKeypair(): Promise<StellarKeypair> {
  const kp = generateKeypairSync();
  await persistKeypair(kp);
  return kp;
}

export async function importAndPersistKeypair(rawSecret: string): Promise<StellarKeypair> {
  const kp = keypairFromSecretSeed(rawSecret);
  await persistKeypair(kp);
  return kp;
}

async function persistKeypair(kp: StellarKeypair): Promise<void> {
  // Seeds are session-memory only — never written to any persistent store.
  // Only the public key (not sensitive) is mirrored for legacy lookups.
  await storage.setItem(PUBLIC_KEY, kp.publicKey);
}

export async function loadPersistedKeypair(): Promise<StellarKeypair | null> {
  // Legacy single-wallet slot reader. Multi-wallet-aware callers
  // should use `loadActiveKeypair()` from wallet-book (or the
  // signing helper `loadSigningKeypair()` in this file) — this
  // one exists purely so wallet-book's own migration path in
  // `loadBook()` can pick up pre-multi-wallet installs.
  const pub = await storage.getItem<string>(PUBLIC_KEY, "");
  const sec = await storage.secureGet<string>(SECRET_KEY, "");
  if (!pub || !sec) return null;
  return { publicKey: pub, secretSeed: sec };
}

/**
 * Multi-wallet-aware signing keypair resolver.
 *
 * Every Soroban signing path (vault create / withdraw / etc.) needs
 * the ACTIVE wallet's secret. Historically we called
 * `loadPersistedKeypair()` which only looked at the legacy single-
 * wallet slot; on multi-wallet installs that slot is empty and every
 * signing attempt bombed with "Reconnect your wallet to sign
 * on-chain transactions", blocking all vault flows.
 *
 * This helper always tries the wallet-book's active wallet first,
 * falling back to the legacy slot only when the book has never been
 * created (fresh installs on very old app versions).
 */
export async function loadSigningKeypair(): Promise<StellarKeypair | null> {
  try {
    const { loadActiveKeypair } = await import("@/src/wallet/wallet-book");
    const active = await loadActiveKeypair();
    if (active?.secretSeed && active?.publicKey) return active;
  } catch {
    // Wallet-book unavailable — fall through to legacy path.
  }
  return loadPersistedKeypair();
}

/**
 * Reveal the active wallet's secret seed.
 *
 * Resolves via the wallet-book, which transparently handles the
 * legacy single-wallet fallback in `loadKeypair()` so old
 * single-wallet installs still work.
 */
export async function revealSecretSeed(): Promise<string | null> {
  // Dynamic import to break the circular dep (wallet-book imports from
  // stellar.ts, and this reveal helper needs to look up the active
  // wallet via wallet-book). Runtime cost is negligible; the export
  // path is only exercised when the user explicitly taps "Export".
  const { loadActiveKeypair } = await import("@/src/wallet/wallet-book");
  const active = await loadActiveKeypair();
  if (active?.secretSeed) return active.secretSeed;
  // Legacy single-wallet fallback (pre-multi-wallet installs where the
  // book was never created).
  const sec = await storage.secureGet<string>(SECRET_KEY, "");
  return sec || null;
}

/**
 * Reveal the active wallet's BIP-39 recovery phrase, if one was stored
 * when the wallet was created/restored from a phrase. Returns null when
 * the wallet was minted/imported as a raw S… secret only.
 */
export async function revealSecretPhrase(): Promise<string | null> {
  const { loadBook } = await import("@/src/wallet/wallet-book");
  const { getWalletMnemonic } = await import("@/src/security/session-keystore");
  const book = await loadBook();
  if (!book.activeId) return null;
  return getWalletMnemonic(book.activeId);
}

export async function clearKeypair(): Promise<void> {
  await storage.secureRemove(SECRET_KEY);
  await storage.removeItem(PUBLIC_KEY);
}

export function shortenAddress(pk: string, head = 6, tail = 6): string {
  if (!pk) return "";
  if (pk.length <= head + tail + 3) return pk;
  return `${pk.slice(0, head)}…${pk.slice(-tail)}`;
}

export { isStellarPublicKey, decodeStrKey };
