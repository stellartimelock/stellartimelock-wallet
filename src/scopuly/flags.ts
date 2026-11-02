// Scopuly signs on its own phone. This app must not open a vault
// handoff until the checks in handoff.ts and verify-return.ts are on
// that path. The flag stays off. The info screen does not read it.
//
// A future on-switch still has to:
// - show amount, recipient, and unlock date on our screen before the link
// - send one vault action, expiring within five minutes
// - leave callback and origin_domain off until a signed return is checked
//   and a request-signing key is published on stellartimelock.com
// - keep withdraw and unlock on this wallet's own key

export const SCOPULY_SEP7_HANDOFF_ENABLED = false;

/** Vault withdraw and unlock sign on this phone. They do not call Scopuly. */
export const VAULT_WITHDRAW_REQUIRES_SCOPULY = false;
