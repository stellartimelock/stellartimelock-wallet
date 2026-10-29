// Permanent Elite accounts — the only copy of this list.
//
// Tier resolution checks these Stellar public keys before subscription
// expiry, vault-count limits, and monthly deposit limits. An account here
// always resolves to Elite and those checks cannot downgrade it.
//
// The Settings test-tier switcher is a separate QA path and applies only
// to DEV_ELITE_WALLET_PUBLIC_KEY. Add further G-addresses to this array.

/** Dev wallet. May use the Settings test-tier switcher for QA. */
export const DEV_ELITE_WALLET_PUBLIC_KEY =
  "GCMZDT4UIWVPMO55MLGLDTD647HTXGLWQ2ZU23EAPO4KGID4CF5BAJRG";

/**
 * Accounts that always resolve to Elite.
 * Dev wallet, Play Store reviewer wallets, the owner account, and
 * lifetime grants.
 */
export const PERMANENT_ELITE_ACCOUNTS: readonly string[] = [
  DEV_ELITE_WALLET_PUBLIC_KEY,
  "GDDZEJ34FUQPNRBMZHIHMPOQR7JNODH3IWAD66PC7PTQXOEF2QZO227E",
  "GDVE75XKKMWTARKSDFO22Q3WHNDQJRPQCXV4B5UQKFRK3J2XMNFH3M6R",
  "GCTWHBAAXP44OF74KEOZU7QEJXJBASDMJ3UDJRGBEY35EMVHAE76RYNW",
  // iblitzc0de, security researcher, lifetime Elite (2026-10-11)
  "GAJT5MLVAFGNEHEBCPKLV7UV4VGY2MUSPOKVVPNF2MVYLXJDBVKWC26G",
];

/** Same list as PERMANENT_ELITE_ACCOUNTS. Kept for existing call sites. */
export const PERMANENT_ELITE_WALLETS: readonly string[] = PERMANENT_ELITE_ACCOUNTS;

/** True when the public key is a permanent Elite account. */
export function isPermanentEliteAccount(
  publicKey: string | null | undefined,
): boolean {
  const pk = (publicKey || "").trim().toUpperCase();
  if (!pk) return false;
  return PERMANENT_ELITE_ACCOUNTS.some(
    (account) => account.trim().toUpperCase() === pk,
  );
}

/**
 * Elite when `publicKey` is permanent Elite; otherwise the tier already
 * decided by subscription, balance, or time checks.
 */
export function resolvePermanentEliteTier<T extends string>(
  tier: T,
  publicKey?: string | null,
): T | "elite" {
  return isPermanentEliteAccount(publicKey) ? "elite" : tier;
}
