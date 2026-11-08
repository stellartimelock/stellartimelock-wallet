// Turn a restore-screen entry into the primary Stellar account.
// A 12- or 24-word phrase uses SEP-0005: BIP-39, then SLIP-0010
// m/44'/148'/0'. A raw S… seed is used as itself.
// This module does not log or return the phrase.

import {
  InvalidMnemonicError,
  isValidMnemonic,
  keypairFromMnemonic,
  looksLikeMnemonic,
  normalizeMnemonic,
} from "@/src/wallet/seed-phrase";
import { InvalidSecretSeedError, keypairFromSecretSeed } from "@/src/wallet/secret-seed";

export interface RestoredAccount {
  kind: "phrase" | "secret";
  /** S… secret for the primary account. Callers keep this in memory. */
  secretSeed: string;
  /** G… address. Safe to show. */
  publicKey: string;
  /** Present when the user typed a recovery phrase. */
  mnemonic?: string;
}

export type RestoreSeedResult =
  | { ok: true; account: RestoredAccount }
  | { ok: false; error: string };

const PHRASE_ERROR = "That recovery phrase isn\u2019t valid. Check the words and try again.";
const SEED_ERROR =
  "Enter a 12- or 24-word recovery phrase, or a 56-character secret seed that starts with S.";

/** Validate the entry and derive the account. Never includes the secret in `error`. */
export function accountFromRestoreInput(raw: string): RestoreSeedResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: SEED_ERROR };

  if (looksLikeMnemonic(trimmed)) {
    if (!isValidMnemonic(trimmed)) return { ok: false, error: PHRASE_ERROR };
    try {
      const mnemonic = normalizeMnemonic(trimmed);
      // Primary account. accountIndex 0 is m/44'/148'/0'.
      const derived = keypairFromMnemonic(mnemonic, 0, "");
      return {
        ok: true,
        account: {
          kind: "phrase",
          secretSeed: derived.secretSeed,
          publicKey: derived.publicKey,
          mnemonic,
        },
      };
    } catch (e) {
      if (e instanceof InvalidMnemonicError) return { ok: false, error: PHRASE_ERROR };
      return { ok: false, error: "Couldn\u2019t derive the Stellar account from that phrase." };
    }
  }

  try {
    const derived = keypairFromSecretSeed(trimmed);
    return {
      ok: true,
      account: {
        kind: "secret",
        secretSeed: derived.secretSeed,
        publicKey: derived.publicKey,
      },
    };
  } catch (e) {
    if (e instanceof InvalidSecretSeedError) return { ok: false, error: SEED_ERROR };
    return { ok: false, error: SEED_ERROR };
  }
}
