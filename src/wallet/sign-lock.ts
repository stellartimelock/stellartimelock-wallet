// Every Stellar signature in this app goes through here.
// A locked session must not sign, even if a screen still holds a seed string.

import { Keypair } from "@stellar/stellar-sdk";

import { isSessionUnlocked } from "../security/session-lock";

export class SessionLockedError extends Error {
  constructor() {
    super("Unlock the wallet with your fingerprint before signing.");
    this.name = "SessionLockedError";
  }
}

export function keypairIfUnlocked(secret: string): Keypair {
  if (!isSessionUnlocked()) {
    throw new SessionLockedError();
  }
  return Keypair.fromSecret(secret);
}
