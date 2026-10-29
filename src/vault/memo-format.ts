/**
 * Memo-based vault discovery — canonical format.
 *
 * Logical form (always):  STL:VAULT:<ref>
 *   - Multi-Sig: <ref> = deployed contract C-address (56 chars)
 *   - Dead Man's Switch: <ref> = vault id decimal on the shared advanced contract
 *
 * Stellar MEMO_TEXT is capped at 28 bytes, so a full C-address cannot ride
 * in a text memo. Wire encoding:
 *   - Multi-Sig → MEMO_HASH = raw 32-byte contract id
 *   - Dead Man's Switch → MEMO_TEXT = "STL:VAULT:<vaultId>"
 *
 * Notification payments always send exactly VAULT_NOTIFY_AMOUNT_XLM so the
 * scanner can soft-filter before probing on-chain.
 */

export const VAULT_MEMO_PREFIX = "STL:VAULT:";
export const VAULT_NOTIFY_AMOUNT_XLM = 0.0001;

/** Build the logical memo string for display / logging. */
export function formatVaultMemo(ref: string): string {
  return `${VAULT_MEMO_PREFIX}${ref.trim()}`;
}

/**
 * Parse a MEMO_TEXT value. Returns the ref when it matches STL:VAULT:<ref>,
 * otherwise null. Accepts numeric vault ids and C-addresses.
 */
export function parseVaultMemoText(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const trimmed = memo.trim();
  if (!trimmed.startsWith(VAULT_MEMO_PREFIX)) return null;
  const ref = trimmed.slice(VAULT_MEMO_PREFIX.length).trim();
  if (!ref) return null;
  return ref;
}

/** True when ref looks like a Soroban contract address. */
export function isContractRef(ref: string): boolean {
  return /^C[A-Z0-9]{55}$/.test(ref.trim());
}

/** True when ref is a decimal vault id (Dead Man's Switch on shared contract). */
export function isVaultIdRef(ref: string): boolean {
  return /^\d+$/.test(ref.trim());
}
