// Unlock fallback for the wallet gate.
//
// A wallet can be on the phone with no way to open it by fingerprint:
// no fingerprint enrolled, no biometric-wrapped signing key, and the
// seed only lived in memory. The gate used to show an almost empty
// screen in that case. These pure helpers decide when to offer the
// seed instead, what to say, and whether a typed seed belongs to the
// active wallet. Nothing here reads or writes storage.

export type BiometricAvailability =
  | "available"
  | "no_hardware"
  | "not_enrolled"
  | "unsupported_web";

/** How long the first fingerprint attempt may take before the seed is offered too. */
export const UNLOCK_FALLBACK_TIMEOUT_MS = 8000;

export interface StrandedInput {
  ready: boolean;
  hasWallet: boolean;
  browseMode: boolean;
  activeId: string | null | undefined;
  activeEntryExists: boolean;
  hasSessionSeed: boolean;
  hasDerivedKey: boolean;
}

/**
 * True when the book has an active wallet but this process has no
 * signing material and no biometric-wrapped key to restore it from.
 * Only the seed can open that wallet.
 */
export function isStrandedWallet(s: StrandedInput): boolean {
  if (!s.ready || s.hasWallet || s.browseMode) return false;
  if (!s.activeId || !s.activeEntryExists) return false;
  return !s.hasSessionSeed && !s.hasDerivedKey;
}

export type FallbackReason =
  | "none"
  | "no_biometrics"
  | "needs_seed"
  | "biometric_failed"
  | "timeout";

export interface FallbackInput {
  availability: BiometricAvailability | null;
  stranded: boolean;
  attemptFailed: boolean;
  timedOut: boolean;
}

export function fallbackReason(f: FallbackInput): FallbackReason {
  if (f.availability === "no_hardware" || f.availability === "not_enrolled") {
    return "no_biometrics";
  }
  if (f.attemptFailed) return f.stranded ? "needs_seed" : "biometric_failed";
  if (f.timedOut) return "timeout";
  return "none";
}

/** Whether the "Try fingerprint again" button belongs on screen. */
export function canRetryFingerprint(availability: BiometricAvailability | null): boolean {
  return availability === "available";
}

export function fallbackMessage(reason: FallbackReason): string | null {
  switch (reason) {
    case "no_biometrics":
      return "Fingerprint unlock isn't set up on this phone. Enter this wallet's secret seed to open it. Your wallet and its data are still here.";
    case "needs_seed":
      return "This wallet needs its secret seed once on this phone. Enter it to open the wallet. Your wallet and its data are still here.";
    case "biometric_failed":
      return "Fingerprint didn't unlock this wallet. Try your fingerprint again, or enter this wallet's secret seed.";
    case "timeout":
      return "Still waiting for the fingerprint. You can enter this wallet's secret seed instead.";
    default:
      return null;
  }
}

export type SeedCheck =
  | { ok: true; seed: string }
  | { ok: false; error: string };

/**
 * Check a typed seed against the active wallet's public key. The
 * caller supplies `derivePublicKey` (Stellar SDK on the phone).
 * The seed is returned only when it opens the expected G address.
 */
export function normalizeSeedInput(input: string): string {
  return (input ?? "").trim().replace(/\s+/g, "").toUpperCase();
}

/** Shape-only check, before any key derivation. Null when the shape is fine. */
export function seedShapeError(input: string): string | null {
  const raw = normalizeSeedInput(input);
  if (!raw || !raw.startsWith("S") || raw.length !== 56) {
    return "Enter the 56-character Stellar secret seed (starts with S).";
  }
  return null;
}

export function checkSeedForWallet(
  input: string,
  expectedPublicKey: string | null | undefined,
  derivePublicKey: (seed: string) => string,
  derivePhrase?: (phrase: string) => { publicKey: string; secretSeed: string },
): SeedCheck {
  const trimmed = (input ?? "").trim();
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const phraseShape =
    (words.length === 12 || words.length === 24) && words.every((word) => /^[a-z]+$/.test(word));
  if (phraseShape) {
    if (!derivePhrase) {
      return { ok: false, error: "Enter a secret seed or a 12- or 24-word recovery phrase." };
    }
    let derived: { publicKey: string; secretSeed: string };
    try {
      derived = derivePhrase(trimmed);
    } catch {
      return { ok: false, error: "That recovery phrase isn\u2019t valid. Check the words and try again." };
    }
    if (!expectedPublicKey) return { ok: false, error: "No active wallet found." };
    if (derived.publicKey !== expectedPublicKey) {
      return { ok: false, error: "That phrase does not match the active wallet. Check and try again." };
    }
    return { ok: true, seed: derived.secretSeed };
  }
  const shape = seedShapeError(input);
  if (shape) return { ok: false, error: shape };
  const raw = normalizeSeedInput(input);
  if (!expectedPublicKey) {
    return { ok: false, error: "No active wallet found." };
  }
  let pub: string;
  try {
    pub = derivePublicKey(raw);
  } catch {
    return { ok: false, error: "That doesn\u2019t look like a valid Stellar secret seed." };
  }
  if (pub !== expectedPublicKey) {
    return { ok: false, error: "Seed does not match the active wallet. Check and try again." };
  }
  return { ok: true, seed: raw };
}
