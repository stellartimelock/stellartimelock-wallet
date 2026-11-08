// wallet-book.ts (multi-wallet).
//
// Manages a list of Stellar wallets with a single "active" one. Public
// metadata (id, label, publicKey, kind, createdAt) lives in
// AsyncStorage as a single JSON blob. Each wallet's SECRET seed lives
// in expo-secure-store under a per-wallet key (`xlm_vault_wallet_secret_<id>`)
// so leaking the metadata blob doesn't expose any signing material.
//
// Migration: on first read, if the legacy single-wallet keys
// (`xlm_vault_wallet_public`, `xlm_vault_wallet_secret`) exist but the
// book is empty, we import them as one entry labeled "My Wallet"
// (kind = "legacy") and mark it active. The old keys are LEFT IN
// PLACE for backward-compat with any code path we haven't refactored
// yet — no destructive wipe.

import { storage } from "@/src/utils/storage";
import { setActiveWalletPublicKeyForTier } from "@/src/tiers/tier-config";
import {
  createAndPersistKeypair,
  keypairFromSecretSeed,
  loadPersistedKeypair,
  type StellarKeypair,
} from "@/src/wallet/stellar";
import { trackEvent } from "@/src/analytics/firebase";
import {
  getWalletSeed,
  removeWalletSeed as removeSessionSeed,
  setWalletSeed,
  warmSessionAfterBiometric,
} from "@/src/security/session-keystore";
import { findEntryByPublicKey } from "@/src/wallet/address-book";

const BOOK_KEY = "xlm_vault_wallet_book_v1";
const LEGACY_PUBLIC_KEY = "xlm_vault_wallet_public";

export type WalletKind = "burner" | "imported" | "legacy";

export interface WalletMeta {
  id: string;
  label: string;
  publicKey: string;
  kind: WalletKind;
  createdAt: number;
  /** Bumped on rename; used for LWW backup merge and Key Manager sync. */
  updatedAt?: number;
}

export interface Book {
  activeId: string | null;
  entries: WalletMeta[];
}

const DEFAULT_BOOK: Book = { activeId: null, entries: [] };

function newId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}


/**
 * Read the book with lazy migration of the single-wallet legacy
 * storage layout. Idempotent.
 */
export async function loadBook(): Promise<Book> {
  const raw = await storage.getItem<Book | null>(BOOK_KEY, null);
  if (raw && Array.isArray(raw.entries) && raw.entries.length > 0) {
    // Mirror the active wallet public key into tier resolution so the
    // permanent dev Elite override can apply per-wallet. Silent — no UI.
    const active = raw.entries.find((e) => e.id === raw.activeId);
    setActiveWalletPublicKeyForTier(active?.publicKey ?? null);
    return raw;
  }
  // Legacy migration: pick up the single persisted keypair, if any,
  // and seed the book with it.
  const legacy = await loadPersistedKeypair();
  if (!legacy) {
    setActiveWalletPublicKeyForTier(null);
    return DEFAULT_BOOK;
  }
  setActiveWalletPublicKeyForTier(legacy.publicKey);
  const id = newId();
  await setWalletSeed(id, legacy.secretSeed);
  const now = Date.now();
  const migrated: Book = {
    activeId: id,
    entries: [
      {
        id,
        label: "My Wallet",
        publicKey: legacy.publicKey,
        kind: "legacy",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  await storage.setItem(BOOK_KEY, migrated);
  return migrated;
}

/** @internal Exported for backup/restore use only. Prefer the public
 *  API functions (`addBurnerWallet`, `addImportedWallet`, etc.) when
 *  mutating the book during normal operation. */
export async function writeBook(book: Book): Promise<void> {
  await storage.setItem(BOOK_KEY, book);
}

/**
 * Return the full keypair for a wallet id. Secret comes from the
 * session-keystore (biometric-gated, in-memory cached); metadata
 * from the book.
 *
 * Performs a hard PUBLIC-KEY VERIFICATION
 * before returning: we derive the ed25519 pubkey from the retrieved
 * seed and refuse to return the pair if it doesn't match the book
 * entry's declared `publicKey`. This closes a cross-assignment
 * bug where a book row's label + publicKey could drift out of sync
 * with the SecureStore seed under the same id (e.g. via a partial
 * write during a restore) and cause the app to SIGN with a key
 * that doesn't match the wallet the user sees on screen.
 */
export async function loadKeypair(id: string): Promise<StellarKeypair | null> {
  const book = await loadBook();
  const entry = book.entries.find((e) => e.id === id);
  if (!entry) return null;
  const seed = await getWalletSeed(id);
  if (!seed) return null;
  // Re-derive the pubkey and compare against the book's declared
  // pubkey. If they disagree, something has gone very wrong — we
  // must NOT silently return a keypair whose signing pubkey doesn't
  // match the identity the user sees. Refuse and log a hard error.
  let derived: StellarKeypair;
  try {
    derived = keypairFromSecretSeed(seed);
  } catch (e) {
    console.warn(
      "[wallet-book] loadKeypair: seed for id",
      id,
      "is malformed:",
      (e as Error)?.message ?? e,
    );
    return null;
  }
  if (derived.publicKey !== entry.publicKey) {
    console.warn(
      "[wallet-book] loadKeypair: SEED/PUBKEY MISMATCH for id",
      id,
      "— refusing to return keypair. Book expected",
      entry.publicKey,
      "but seed derives to",
      derived.publicKey,
    );
    return null;
  }
  return derived;
}

/**
 * Convenience: keypair of the currently active wallet.
 */
export async function loadActiveKeypair(): Promise<StellarKeypair | null> {
  const book = await loadBook();
  if (!book.activeId) return null;
  return loadKeypair(book.activeId);
}

/**
 * Create a brand new burner wallet, save it, and return the pair
 * (meta + keypair). If `makeActive=true` (default) the new wallet
 * becomes the active one.
 */
export async function addBurnerWallet(
  label: string,
  makeActive: boolean = true,
): Promise<{ meta: WalletMeta; keypair: StellarKeypair; label: string }> {
  const kp = await createAndPersistKeypair();
  // createAndPersistKeypair also writes the LEGACY single-wallet
  // keys; that's fine — those act as a "last active" mirror the rest
  // of the app can still read from during the transition.
  const id = newId();
  await setWalletSeed(id, kp.secretSeed);
  const book = await loadBook();
  const baseLabel = (label || "").trim() || "New Wallet";
  const usedLabels = new Set(book.entries.map((e) => e.label));
  let finalLabel = baseLabel;
  if (usedLabels.has(finalLabel)) {
    let n = 2;
    while (usedLabels.has(`${baseLabel} (${n})`)) n++;
    finalLabel = `${baseLabel} (${n})`;
  }
  const now = Date.now();
  const meta: WalletMeta = {
    id,
    label: finalLabel,
    publicKey: kp.publicKey,
    kind: "burner",
    createdAt: now,
    updatedAt: now,
  };
  book.entries.push(meta);
  if (makeActive) book.activeId = id;
  await writeBook(book);
  // Keep Key Manager label in sync when this pubkey already has an entry.
  try {
    const { syncKeyManagerLabelForPublicKey } = await import(
      "@/src/security/key-manager-store"
    );
    await syncKeyManagerLabelForPublicKey(kp.publicKey, finalLabel, { confirmShrink: true });
  } catch {
    /* non-fatal */
  }
  trackEvent({ name: "wallet_created", method: "burner" });
  return { meta, keypair: kp, label: finalLabel };
}

/**
 * Look up whether a public key already has a saved nickname from a
 * previous session.
 *
 * Currently checks the Address Book (saved contacts) — a user may
 * have already labelled this exact address (their own exchange
 * deposit wallet, a cold wallet, etc.) before ever importing it as a
 * signing wallet here. Add/import screens can call this to pre-fill
 * the name field instead of prompting from scratch. Returns `null`
 * if nothing is found, or if the address book can't be read yet
 * (e.g. PMK not ready) — a lookup failure should never block an
 * import, just fall back to the generic default.
 */
export async function suggestLabelForPublicKey(
  publicKey: string,
): Promise<string | null> {
  try {
    const contact = await findEntryByPublicKey(publicKey, "stellar");
    return contact?.label?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Import an existing wallet from its S... secret seed.
 */
export async function addImportedWallet(
  label: string,
  rawSecret: string,
  makeActive: boolean = true,
): Promise<{
  meta: WalletMeta;
  keypair: StellarKeypair;
  wasAlreadyImported: boolean;
  /** True when `meta.label` came from a saved Address Book contact
   * rather than caller input or the generic fallback. */
  autoMatchedLabel: boolean;
}> {
  // Throws InvalidSecretSeedError on malformed input BEFORE any
  // storage writes so the book is never partially mutated on bad
  // inputs.
  const kp = keypairFromSecretSeed(rawSecret);

  const book = await loadBook();

  // Return the existing entry (idempotent). Also signal the caller with
  // `wasAlreadyImported=true` so the UI can surface a helpful toast.
  const existing = book.entries.find((e) => e.publicKey === kp.publicKey);
  if (existing) {
    if (existing.publicKey !== kp.publicKey) {
      throw new Error(
        "Internal: wallet-book entry publicKey mismatch during re-key.",
      );
    }
    // Re-key the secret in case SecureStore lost it between sessions.
    await setWalletSeed(existing.id, kp.secretSeed);
    if (makeActive) {
      book.activeId = existing.id;
      await writeBook(book);
    }
    trackEvent({ name: "wallet_imported", already_present: true });
    trackEvent({ name: "wallet_created", method: "imported" });
    return { meta: existing, keypair: kp, wasAlreadyImported: true, autoMatchedLabel: false };
  }

  // Before falling back to a generic placeholder, check whether this public key
  // already has a nickname saved from a previous session (e.g. Address Book).
  const requested = (label || "").trim();
  let autoMatchedLabel = false;
  let baseLabel = requested;
  if (!baseLabel) {
    const suggested = await suggestLabelForPublicKey(kp.publicKey);
    if (suggested) {
      baseLabel = suggested;
      autoMatchedLabel = true;
    }
  }

  // If another wallet already uses the requested label, auto-append " (2)", " (3)"…
  baseLabel = baseLabel || "Imported Wallet";
  const usedLabels = new Set(book.entries.map((e) => e.label));
  let finalLabel = baseLabel;
  if (usedLabels.has(finalLabel)) {
    let n = 2;
    while (usedLabels.has(`${baseLabel} (${n})`)) n++;
    finalLabel = `${baseLabel} (${n})`;
  }

  // Write the secret BEFORE mutating the book so loadKeypair never sees meta without secret.
  const id = newId();
  await setWalletSeed(id, kp.secretSeed);

  const now = Date.now();
  const meta: WalletMeta = {
    id,
    label: finalLabel,
    publicKey: kp.publicKey,
    kind: "imported",
    createdAt: now,
    updatedAt: now,
  };
  book.entries.push(meta);
  if (makeActive) book.activeId = id;
  await writeBook(book);
  // Keep Key Manager label in sync when this pubkey already has an entry.
  try {
    const { syncKeyManagerLabelForPublicKey } = await import(
      "@/src/security/key-manager-store"
    );
    await syncKeyManagerLabelForPublicKey(kp.publicKey, finalLabel, { confirmShrink: true });
  } catch {
    /* non-fatal */
  }
  trackEvent({ name: "wallet_imported", already_present: false });
  trackEvent({ name: "wallet_created", method: "imported" });
  return { meta, keypair: kp, wasAlreadyImported: false, autoMatchedLabel };
}

/**
 * Swap the active wallet.
 */
export async function setActiveWallet(id: string): Promise<StellarKeypair | null> {
  const book = await loadBook();
  const entry = book.entries.find((e) => e.id === id);
  if (!entry) return null;
  book.activeId = id;
  setActiveWalletPublicKeyForTier(entry.publicKey);
  await writeBook(book);
  // Also refresh the LEGACY mirror so any un-refactored consumer of
  // `loadPersistedKeypair()` picks up the new active wallet without
  // needing to be rewired to `loadActiveKeypair()`.
  // Route through session-keystore so the seed
  // read is biometric-gated and cached for the session.
  const seed = await getWalletSeed(id);
  if (seed) {
    const { keypairFromSecretSeed: fromSeed } = await import(
      "@/src/wallet/stellar"
    );
    const kp = fromSeed(seed);
    // Mirror the public key for legacy callers; seed is never written to storage.
    await storage.setItem(LEGACY_PUBLIC_KEY, kp.publicKey);
    return kp;
  }
  const warmed = await warmSessionAfterBiometric(id);
  if (warmed) {
    const restored = await getWalletSeed(id);
    if (restored) {
      const { keypairFromSecretSeed: fromSeed } = await import(
        "@/src/wallet/stellar"
      );
      const kp = fromSeed(restored);
      await storage.setItem(LEGACY_PUBLIC_KEY, kp.publicKey);
      return kp;
    }
  }
  return null;
}

/**
 * Rename a wallet. Idempotent. Auto-numbers colliding labels so two
 * entries never share the same name. Also mirrors the label onto any
 * Key Manager entry with the same public key so names stay unified.
 */
export async function renameWallet(id: string, label: string): Promise<string> {
  const book = await loadBook();
  const entry = book.entries.find((e) => e.id === id);
  if (!entry) return "";
  const baseLabel = (label || "").trim() || entry.label;
  // No-op if already the same name.
  if (baseLabel === entry.label) return entry.label;
  const usedLabels = new Set(
    book.entries.filter((e) => e.id !== id).map((e) => e.label),
  );
  let finalLabel = baseLabel;
  if (usedLabels.has(finalLabel)) {
    let n = 2;
    while (usedLabels.has(`${baseLabel} (${n})`)) n++;
    finalLabel = `${baseLabel} (${n})`;
  }
  entry.label = finalLabel;
  entry.updatedAt = Date.now();
  await writeBook(book);
  try {
    const { syncKeyManagerLabelForPublicKey } = await import(
      "@/src/security/key-manager-store"
    );
    await syncKeyManagerLabelForPublicKey(entry.publicKey, finalLabel, { confirmShrink: true });
  } catch {
    /* non-fatal — book rename already persisted */
  }
  return finalLabel;
}

/**
 * Rename a wallet matched by public key (used when Key Manager is the
 * source of a label change). Returns the final label, or null if no
 * book entry matches. Updates the book directly without re-entering
 * Key Manager sync (the KM entry was just written by the caller).
 */
export async function renameWalletByPublicKey(
  publicKey: string,
  label: string,
): Promise<string | null> {
  const pk = (publicKey || "").trim().toUpperCase();
  if (!pk) return null;
  const book = await loadBook();
  const entry = book.entries.find((e) => e.publicKey === pk);
  if (!entry) return null;
  const baseLabel = (label || "").trim() || entry.label;
  if (baseLabel === entry.label) return entry.label;
  const usedLabels = new Set(
    book.entries.filter((e) => e.id !== entry.id).map((e) => e.label),
  );
  let finalLabel = baseLabel;
  if (usedLabels.has(finalLabel)) {
    let n = 2;
    while (usedLabels.has(`${baseLabel} (${n})`)) n++;
    finalLabel = `${baseLabel} (${n})`;
  }
  entry.label = finalLabel;
  entry.updatedAt = Date.now();
  await writeBook(book);
  // If collision renumbered the label, push the final name back to KM.
  if (finalLabel !== baseLabel) {
    try {
      const { syncKeyManagerLabelForPublicKey } = await import(
        "@/src/security/key-manager-store"
      );
      await syncKeyManagerLabelForPublicKey(pk, finalLabel, { confirmShrink: true });
    } catch {
      /* non-fatal */
    }
  }
  return finalLabel;
}

/**
 * Delete a wallet (metadata AND stored secret). If the removed
 * wallet was active, we auto-promote whichever remaining wallet was
 * added most recently. Returns the id of the new active wallet (or
 * null if the book is now empty).
 */
export async function removeWallet(id: string): Promise<string | null> {
  const book = await loadBook();
  const idx = book.entries.findIndex((e) => e.id === id);
  if (idx < 0) return book.activeId;
  book.entries.splice(idx, 1);
  await removeSessionSeed(id);
  if (book.activeId === id) {
    const promote = [...book.entries].sort((a, b) => b.createdAt - a.createdAt)[0];
    book.activeId = promote?.id ?? null;
    if (promote) {
      setActiveWalletPublicKeyForTier(promote.publicKey);
      await storage.setItem(LEGACY_PUBLIC_KEY, promote.publicKey);
    } else {
      setActiveWalletPublicKeyForTier(null);
      // No wallets left — clear the legacy mirror so useSession's
      // boot path shows the connect/import screen again.
      await storage.secureRemove("xlm_vault_wallet_secret");
      await storage.removeItem(LEGACY_PUBLIC_KEY);
    }
  }
  await writeBook(book);
  return book.activeId;
}

/**
 * Full wipe (all wallets + legacy mirror). Used by the existing
 * "Disconnect wallet" flow in Settings.
 */
export async function clearBook(): Promise<void> {
  let entries: { id: string }[] = [];
  try {
    entries = (await loadBook()).entries;
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    try {
      await removeSessionSeed(entry.id);
    } catch {
      /* A failed seed delete must not leave the book in place. */
    }
  }
  try {
    setActiveWalletPublicKeyForTier(null);
  } catch {
    /* non-fatal */
  }
  try {
    await storage.removeItem(BOOK_KEY);
  } catch {
    /* non-fatal */
  }
  try {
    await storage.secureRemove("xlm_vault_wallet_secret");
  } catch {
    /* non-fatal */
  }
  try {
    await storage.removeItem(LEGACY_PUBLIC_KEY);
  } catch {
    /* non-fatal */
  }
  const { releaseSessionAfterDisconnect } = await import("@/src/security/session-keystore");
  releaseSessionAfterDisconnect();
}
