// Legacy on-phone seed slots from builds that stored the S… string.
//
// When the biometric flag is set, the seed is read only through an
// authenticated SecureStore read. A plain copy is moved into the
// auth-gated slot after that read succeeds, then the plain copy is
// deleted. A cancelled prompt returns no seed and does not touch the
// plain slot or the flag. When the flag is absent, the plain slot is
// the fallback for older wallets. This module never clears the flag
// and never writes the plain slot. Backup files are not involved.

export const SEED_AUTH_PROMPT = "Unlock Stellar TimeLock";

export interface AuthenticatedSeedRead {
  /** False when the user cancelled or the gated read failed. */
  promptSucceeded: boolean;
  value: string | null;
}

export interface LegacySeedIO {
  authFlag: boolean;
  readAuthenticated(): Promise<AuthenticatedSeedRead>;
  readPlain(): Promise<string | null>;
  writeAuthenticated(seed: string): Promise<boolean>;
  deletePlain(): Promise<void>;
}

function nonempty(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read a legacy on-disk seed.
 *
 * Opted-in (auth flag set) and the gated read did not succeed: returns
 * null. The plain slot is not consulted, so a cancelled prompt cannot
 * unlock the wallet.
 *
 * Opted-in and the gated read succeeded: the seed is kept in the
 * auth-gated slot. A leftover plain copy is deleted only after that
 * copy is written. The flag is left set.
 *
 * Flag absent: the plain slot is returned and left in place.
 */
export async function loadLegacySeed(io: LegacySeedIO): Promise<string | null> {
  if (!io.authFlag) {
    return nonempty(await io.readPlain());
  }

  const gated = await io.readAuthenticated();
  if (!gated.promptSucceeded) return null;

  const authed = nonempty(gated.value);
  if (authed) {
    const copied = await io.writeAuthenticated(authed);
    if (copied) await io.deletePlain();
    return authed;
  }

  const plain = nonempty(await io.readPlain());
  if (!plain) return null;
  const moved = await io.writeAuthenticated(plain);
  if (!moved) return null;
  await io.deletePlain();
  return plain;
}
