// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Stellar TimeLock contributors
//
// Session-scoped wallet-seed cache — memory only.
//
// DESIGN
// ------
// The Stellar secret seed (S… string) for a current wallet lives in the
// in-memory session cache. New writes do not put that string in the plain
// SecureStore slot. Biometrics cache the 32-byte derived signing key
// (ciphertext under the HKDF wrapping key). An older install that opted
// into biometrics is read only through the auth-gated slot; a plain copy
// is moved there after a successful fingerprint and then deleted. The
// biometric flag is not cleared to skip that prompt. Save files stay
// encrypted with the seed, so a backup still opens on another phone.
//
// SESSION LIFECYCLE
// -----------------
//   1. First entry:
//      The user types their seed. `warmSessionFromVerifiedSeed` places
//      it in the cache and wraps the 32-byte derived signing key behind
//      the biometric HKDF key (never the S… string).
//
//   2. Active use:
//      The cache is read by signing operations and other seed consumers.
//      Every access calls `touch()` to defer the idle-lock timer.
//
//   3. Idle lock (5-minute inactivity):
//      `lockNow()` sets `sessionLocked = true` and clears the session
//      cache. A later fingerprint unwraps the derived signing key (or,
//      for an older install, the auth-gated seed slot). The plain slot
//      is not read while the biometric flag is set.
//
//   4. Biometric warm-unlock (idle, same process):
//      Cache hit → clear `sessionLocked`. No disk read. After a lock the
//      cache is empty, so this falls through to the derived key.
//
//   5. Cold start:
//      Cache is empty. `warmSessionAfterBiometric` unwraps the biometric-
//      cached 32-byte signing key, rebuilds the S… seed in RAM, and
//      returns true. Seed fallback is only for first-ever entry, a new
//      phone, or a missing biometric blob.
//
//   6. App kill / explicit disconnect:
//      Memory is released. Next open uses step 5 (fingerprint), not a
//      fresh seed prompt, when a derived-key blob exists.
//
// BIOMETRICS
// ----------
// The biometric HKDF root in `biometric.ts` wraps the 32-byte derived
// signing key. A current wallet does not write the S… string. An older
// opted-in copy can sit in the auth-gated slot until that derived key
// is saved. Save files stay seed-derived (not device-bound) so a backup
// still opens on a new phone after the seed is typed once.
//
// SAVE-FILE PORTABILITY
// ---------------------
// .stvault backups are encrypted with PBKDF2(seed) — purely seed-derived,
// not device-bound. A backup opened on a different phone with the same seed
// always decrypts correctly, regardless of which device enrolled biometrics.
//
// LIMITATIONS
// -----------
// • This module cannot protect against a process-resident attacker. The moment
//   the seed lives in the JS heap, it is accessible to any in-process code.
//   That is why we zero cached copies on drop (see `wipeCacheEntry`).
// • Web / Expo Go alias plain SecureStore to AsyncStorage. The trust boundary
//   is the native Android/iOS build only.

import { AppState, type AppStateStatus } from "react-native";

import { authenticate, clearSessionRoot } from "@/src/security/biometric";
import {
  loadLegacySeed,
  SEED_AUTH_PROMPT,
} from "@/src/security/legacy-seed-slot";
import { publishSessionLock } from "@/src/security/session-lock";
import { storage } from "@/src/utils/storage";
import { wipeBytes } from "@/src/security/secure-wipe";
import { publishUnlockSeed } from "@/src/security/wallet-seed-memory";
import {
  dropCachedWrappingKey,
  hasDerivedSigningKey,
  persistDerivedSigningKey,
  removeDerivedSigningKey,
  restoreSecretSeedFromDerivedKey,
} from "@/src/security/derived-signing-key";

// Per-wallet SecureStore keys from builds that stored the S… string.
// The plain key is read only when the biometric flag is absent. When
// the flag is set, the seed moves to the auth-gated key after a
// successful fingerprint and the plain key is deleted. New wallets do
// not write the S… string; they wrap the derived signing key instead.
const LEGACY_SECRET_PREFIX = "xlm_vault_wallet_secret_";
// Old authenticated-slot flag. Never cleared just to skip a prompt.
const LEGACY_AUTH_FLAG_PREFIX = "xlm_vault_wallet_secret_auth_v1_";

/** Optional BIP-39 mnemonic stored alongside the derived S… secret. */
const MNEMONIC_PREFIX = "xlm_vault_wallet_mnemonic_";

// ─── Session cache ────────────────────────────────────────────────────────────
// Values are 56-char Stellar secret seeds. Never written to any storage.
const sessionCache = new Map<string, string>();

// UI access gate. Set by lockNow(), which also clears the cache.
// Cleared by warmSessionAfterBiometric or warmSessionFromVerifiedSeed.
let sessionLocked = false;

function publishLock(): void {
  publishSessionLock(sessionLocked, sessionCache.size > 0);
}

// Lock-state pub/sub — BiometricGate subscribes via subscribeSessionLock.
type LockListener = () => void;
const lockListeners = new Set<LockListener>();

export function subscribeSessionLock(fn: LockListener): () => void {
  lockListeners.add(fn);
  return () => {
    lockListeners.delete(fn);
  };
}

function notifyLockChange(): void {
  for (const l of lockListeners) {
    try {
      l();
    } catch {
      /* one listener throwing must never break the rest */
    }
  }
}

/**
 * Wall-clock time of the last session-cache touch. Used by the idle-lock
 * heartbeat to decide when to lock without a full app teardown.
 */
let lastActivityMs = Date.now();
function touch(): void {
  lastActivityMs = Date.now();
}

/**
 * Idle timeout before the UI lock engages. 5 minutes matches the
 * industry-standard "wallet locked after inactivity" behaviour.
 */
const IDLE_LOCK_MS = 5 * 60 * 1000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve the seed for `id` from the session cache.
 * Returns `null` when this session has no seed, or while the idle lock is on.
 * This does not read SecureStore. A wallet with the biometric flag set is
 * not unlocked from the plain slot here — that would skip the fingerprint.
 * Disk seeds are loaded only by `warmSessionAfterBiometric`.
 * Signing and UI reads wait for a fingerprint grant. Deep links cannot spend while locked.
 */
export async function getWalletSeed(id: string): Promise<string | null> {
  publishLock();
  // Lock clears the cache. Signing and UI reads wait for a fingerprint grant.
  if (sessionLocked) return null;
  const cached = sessionCache.get(id);
  if (cached) {
    touch();
    return cached;
  }
  return null;
}

/**
 * Place a seed in the session cache. The S… string is not written to the
 * plain SecureStore slot. When the biometric flag is set and the derived
 * key cannot be saved, the seed is copied to the auth-gated slot and any
 * plain copy is deleted. The flag is not cleared.
 */
export async function setWalletSeed(
  id: string,
  seed: string,
): Promise<boolean> {
  const wasLocked = !isUnlocked();
  sessionCache.set(id, seed);
  sessionLocked = false;
  touch();
  publishLock();
  if (wasLocked) notifyLockChange();
  const wrapped = await persistDerivedSigningKey(id, seed);
  await retirePlainSeed(id, seed, wrapped);
  mirrorSeedToPicker();
  return true;
}

export async function disableBiometricAuth(id: string): Promise<boolean> {
  await removeDerivedSigningKey(id);
  return true;
}

export async function enableBiometricAuth(id: string): Promise<boolean> {
  const seed = sessionCache.get(id);
  if (!seed) return true;
  return persistDerivedSigningKey(id, seed);
}

/** True when this process already holds a seed for `id`. */
export function hasSessionSeed(id: string): boolean {
  return sessionCache.has(id);
}

/** True when at least one seed is sitting in RAM. */
export function hasAnySessionSeed(): boolean {
  return sessionCache.size > 0;
}

/**
 * The wallet seed currently in RAM, if the UI lock is clear.
 * Key Manager encryption uses this. Idle lock hides it from the UI;
 * the process copy for PICK_KEY stays until the cache is wiped.
 */
export function unlockedWalletSeed(): string | null {
  if (sessionLocked || sessionCache.size === 0) return null;
  const first = sessionCache.values().next().value;
  return typeof first === "string" && first.length > 0 ? first : null;
}

function mirrorSeedToPicker(): void {
  const first = sessionCache.values().next().value;
  publishUnlockSeed(typeof first === "string" ? first : null);
}

export { hasDerivedSigningKey };

/**
 * Remove the seed from the in-memory cache AND clean up any legacy
 * SecureStore remnants from older app versions. Called by the
 * disconnect / remove-wallet flow.
 */
export async function removeWalletSeed(id: string): Promise<void> {
  wipeCacheEntry(id);
  await storage.secureRemove(legacySecretKeyFor(id));
  await storage.secureRemove(authSeedKey(id));
  await storage.removeItem(legacyAuthFlagKeyFor(id));
  await removeDerivedSigningKey(id);
  await removeWalletMnemonic(id);
  mirrorSeedToPicker();
}

/**
 * Drop every in-memory seed and the UI lock. Disconnect calls this after
 * the per-wallet deletes so a later restore is not blocked by a leftover lock.
 */
export function releaseSessionAfterDisconnect(): void {
  sessionLocked = false;
  for (const id of Array.from(sessionCache.keys())) wipeCacheEntry(id);
  sessionCache.clear();
  clearSessionRoot();
  dropCachedWrappingKey();
  publishLock();
  mirrorSeedToPicker();
}

/**
 * Persist a BIP-39 recovery phrase for a wallet id (when the wallet
 * was created or restored from a phrase). The signing path still uses
 * the derived S… secret from `setWalletSeed` — this slot is only for
 * offline phrase export and does not contain the seed.
 */
const MNEMONIC_AUTH_PROMPT = "Unlock to use your recovery phrase";

export async function setWalletMnemonic(
  id: string,
  mnemonic: string,
): Promise<boolean> {
  const value = (mnemonic ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return false;
  // The phrase is the seed. Store it only behind a biometric read.
  const ok = await storage.secureSetAuthenticated(
    authMnemonicKey(id),
    value,
    MNEMONIC_AUTH_PROMPT,
  );
  if (ok) await storage.secureRemove(mnemonicKeyFor(id));
  return ok;
}

export async function getWalletMnemonic(id: string): Promise<string | null> {
  const authed = await storage.secureGetAuthenticated<string>(
    authMnemonicKey(id),
    "",
    MNEMONIC_AUTH_PROMPT,
  );
  if (authed) return authed;
  const legacy = await storage.secureGet<string>(mnemonicKeyFor(id), "");
  if (!legacy) return null;
  // Old installs wrote the phrase without a biometric gate. Move it on the
  // next successful fingerprint, and do not return it if that prompt is canceled.
  const ok = await authenticate(MNEMONIC_AUTH_PROMPT);
  if (!ok) return null;
  const moved = await storage.secureSetAuthenticated(
    authMnemonicKey(id),
    legacy,
    MNEMONIC_AUTH_PROMPT,
  );
  if (moved) await storage.secureRemove(mnemonicKeyFor(id));
  return legacy;
}

export async function removeWalletMnemonic(id: string): Promise<void> {
  await storage.secureRemove(authMnemonicKey(id));
  await storage.secureRemove(mnemonicKeyFor(id));
}

/**
 * After a successful biometric check, restore access without a second
 * seed entry:
 *
 *   • Cache still holds the seed (idle lock) → just clear the UI lock.
 *
 *   • Otherwise unwrap the biometric-cached 32-byte signing key and
 *     rebuild the S… seed in RAM.
 *
 *   • Last resort: a legacy on-disk S… slot. If the biometric flag is
 *     set, that read goes through the auth-gated slot only. A plain
 *     copy is moved there after the fingerprint, then deleted. The
 *     flag is not removed. With the flag absent, the plain slot is
 *     the fallback for an older wallet.
 */
export async function warmSessionAfterBiometric(
  id: string,
): Promise<boolean> {
  // Warm path: seed already in memory from this session.
  if (sessionCache.has(id)) {
    const wasLocked = sessionLocked;
    sessionLocked = false;
    touch();
    publishLock();
    if (wasLocked) notifyLockChange();
    mirrorSeedToPicker();
    return true;
  }

  const restored = await restoreSecretSeedFromDerivedKey(id);
  if (restored) {
    const wasLocked = sessionLocked || sessionCache.size === 0;
    sessionCache.set(id, restored);
    sessionLocked = false;
    touch();
    publishLock();
    if (wasLocked) notifyLockChange();
    mirrorSeedToPicker();
    return true;
  }

  // Legacy S… slots. Biometric flag: authenticated read only, then drop
  // the plain copy. No flag: plain slot, for wallets that never opted in.
  // The flag is not deleted here. Doing that used to skip the fingerprint
  // on the next open.
  const legacy = await readLegacyWalletSeed(id);
  if (legacy) {
    const wasLocked = sessionLocked || sessionCache.size === 0;
    sessionCache.set(id, legacy);
    sessionLocked = false;
    touch();
    publishLock();
    const wrapped = await persistDerivedSigningKey(id, legacy);
    if (wrapped) {
      // Derived key is enough for the next cold start. Drop leftover
      // S… copies. The biometric flag stays set.
      await storage.secureRemove(legacySecretKeyFor(id));
      await storage.secureRemove(authSeedKey(id));
    }
    if (wasLocked) notifyLockChange();
    mirrorSeedToPicker();
    return true;
  }

  return false;
}

/**
 * Place a manually verified seed into the session cache and clear the UI
 * lock. Called by BiometricGate's seed-fallback modal after the caller has
 * confirmed the seed derives to the active wallet's public key.
 *
 * The S… string stays in memory. The 32-byte derived signing key is
 * wrapped behind biometrics so the next cold start does not need the seed.
 */
export function warmSessionFromVerifiedSeed(id: string, seed: string): void {
  const wasLocked = !isUnlocked();
  sessionCache.set(id, seed);
  sessionLocked = false;
  touch();
  publishLock();
  if (wasLocked) notifyLockChange();
  void persistDerivedSigningKey(id, seed);
  mirrorSeedToPicker();
}

/**
 * Drop just the cached copy of a wallet's seed WITHOUT touching
 * any storage. Used by the wallet-switcher so switching accounts
 * doesn't leave the previous wallet's seed dangling in the cache.
 */
export function dropWallet(id: string): void {
  wipeCacheEntry(id);
  mirrorSeedToPicker();
}

/**
 * Lock the session and clear the in-memory seed cache. The next open
 * needs a fingerprint: the derived signing key, or the auth-gated legacy
 * slot when that flag is set. The plain slot is not a shortcut.
 *
 * For an explicit full wipe (e.g. disconnect wallet), call
 * `removeWalletSeed` for each wallet id.
 *
 * Called by:
 *   • Settings → Lock now (via BiometricGate.invalidateBiometricUnlock)
 *   • Idle-lock heartbeat (see below)
 *   • App-lifecycle background handler
 */
export function lockNow(): void {
  const hadSeed = sessionCache.size > 0;
  const wasUnlocked = hadSeed && !sessionLocked;
  sessionLocked = true;
  for (const id of Array.from(sessionCache.keys())) {
    wipeCacheEntry(id);
  }
  sessionCache.clear();
  // The wrapping key and biometric root would otherwise rebuild the seed
  // with no new fingerprint after the cache wipe.
  clearSessionRoot();
  dropCachedWrappingKey();
  publishLock();
  mirrorSeedToPicker();
  if (wasUnlocked || hadSeed) notifyLockChange();
}

/**
 * True if at least one seed is in the cache AND the UI lock is cleared.
 */
export function isUnlocked(): boolean {
  publishLock();
  return sessionCache.size > 0 && !sessionLocked;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function legacySecretKeyFor(id: string): string {
  return `${LEGACY_SECRET_PREFIX}${id}`;
}

function authSeedKey(id: string): string {
  return `${LEGACY_SECRET_PREFIX}auth_${id}`;
}

/**
 * When the biometric flag is set, do not leave the S… string in the
 * plain slot. A saved derived key replaces both copies. If that save
 * fails, move the seed into the auth-gated slot and then delete the
 * plain copy. The flag stays set either way.
 */
async function retirePlainSeed(
  id: string,
  seed: string,
  wrapped: boolean,
): Promise<void> {
  const authOn = !!(await storage.getItem<boolean>(legacyAuthFlagKeyFor(id), false));
  if (wrapped) {
    await storage.secureRemove(legacySecretKeyFor(id));
    if (authOn) await storage.secureRemove(authSeedKey(id));
    return;
  }
  if (!authOn) return;
  const moved = await storage.secureSetAuthenticated(
    authSeedKey(id),
    seed,
    SEED_AUTH_PROMPT,
  );
  if (moved) await storage.secureRemove(legacySecretKeyFor(id));
}

async function readLegacyWalletSeed(id: string): Promise<string | null> {
  const authFlag = !!(await storage.getItem<boolean>(legacyAuthFlagKeyFor(id), false));
  return loadLegacySeed({
    authFlag,
    readAuthenticated: async () => {
      const read = await storage.secureReadAuthenticated<string>(
        legacySecretKeyFor(id),
        "",
        SEED_AUTH_PROMPT,
      );
      if (!read.promptSucceeded) return { promptSucceeded: false, value: null };
      if (read.value) return { promptSucceeded: true, value: read.value };
      // The first prompt already succeeded and the historical slot was
      // empty. A second read of the dedicated auth key may also prompt.
      // Cancelling that second prompt must not throw away the fingerprint
      // we already have, or a plain copy could never be moved.
      const dedicated = await storage.secureReadAuthenticated<string>(
        authSeedKey(id),
        "",
        SEED_AUTH_PROMPT,
      );
      return { promptSucceeded: true, value: dedicated.value };
    },
    readPlain: async () => {
      const plain = await storage.secureGet<string>(legacySecretKeyFor(id), "");
      return plain || null;
    },
    writeAuthenticated: (value) =>
      storage.secureSetAuthenticated(authSeedKey(id), value, SEED_AUTH_PROMPT),
    deletePlain: async () => {
      await storage.secureRemove(legacySecretKeyFor(id));
    },
  });
}

function legacyAuthFlagKeyFor(id: string): string {
  return `${LEGACY_AUTH_FLAG_PREFIX}${id}`;
}

function mnemonicKeyFor(id: string): string {
  return `${MNEMONIC_PREFIX}${id}`;
}

function authMnemonicKey(id: string): string {
  return `${MNEMONIC_PREFIX}auth_${id}`;
}

/**
 * Best-effort wipe of a cached seed before removing the map entry.
 * Strings in JS are immutable so we can't literally zero the backing
 * bytes, but overwriting the map slot with zeros means a debugger
 * inspecting the Map is less likely to see the seed.
 */
function wipeCacheEntry(id: string): void {
  const s = sessionCache.get(id);
  if (typeof s === "string" && s.length > 0) {
    sessionCache.set(id, "0".repeat(s.length));
  }
  sessionCache.delete(id);
  publishLock();
  if (__DEV__) {
    const scratch = new Uint8Array(1);
    wipeBytes(scratch);
  }
}

// ─── Idle-lock heartbeat ──────────────────────────────────────────────────────

let _appStateSub: { remove(): void } | null = null;
let _backgroundedAtMs: number | null = null;

/**
 * Wire the AppState listener that auto-locks when the app has been
 * backgrounded for longer than IDLE_LOCK_MS. Called once by `_layout.tsx`.
 * Idempotent.
 */
export function installIdleLock(): void {
  if (_appStateSub) return;
  _appStateSub = AppState.addEventListener(
    "change",
    (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        _backgroundedAtMs = Date.now();
        return;
      }
      if (next === "active" && _backgroundedAtMs != null) {
        const idleFor = Date.now() - _backgroundedAtMs;
        _backgroundedAtMs = null;
        if (idleFor >= IDLE_LOCK_MS) {
          lockNow();
        }
      }
      // Foreground idle check.
      if (Date.now() - lastActivityMs >= IDLE_LOCK_MS) {
        lockNow();
      }
    },
  );
}

/**
 * Uninstall — used by tests. Idempotent.
 */
export function uninstallIdleLock(): void {
  if (_appStateSub) {
    _appStateSub.remove();
    _appStateSub = null;
  }
  _backgroundedAtMs = null;
}
