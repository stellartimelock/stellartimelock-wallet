// Multi-Asset Vault BETA — contract config.
//
// This file is intentionally decoupled from `src/wallet/contract-config.ts`
// so the beta can be ripped out (rm -rf this folder) without leaving stray
// references in the production config surface.
//
// The beta targets Mainnet. The Soroban contract itself is
// network-agnostic (no compile-time network dependency); it targets
// `mainnet`. The env flag
// remains the master switch — set `EXPO_PUBLIC_MULTI_ASSET_BETA=1`
// to expose the toggle in the UI.

/**
 * True if the Multi-Asset BETA is currently usable. Requires ONLY:
 *   - `EXPO_PUBLIC_MULTI_ASSET_BETA=1` in the environment (opt-in).
 *
 * The beta signs against Mainnet (see `client.ts` — uses the active
 * deployment's passphrase, which will be `Networks.PUBLIC` when the
 * user is on mainnet). The Beta badge on the card keeps the
 * experimental nature explicit even though funds are real.
 */
export function isMultiAssetBetaEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_MULTI_ASSET_BETA;
  return flag === "1" || flag === "true";
}

/**
 * Contract id (56-char C… address) of the Multi-Asset vault on Stellar
 * Mainnet. Set this after `deploy.sh` prints the deployed id.
 */
export const MULTI_ASSET_MAINNET_CONTRACT_ID = "CBKOYL6BHVCHB4DJFVNHLGJKLCIFVRRRDVN2NRWX6TKRHQJQZQHPCACV";

/**
 * Backwards-compatible alias. The name held during
 * the Testnet-beta phase; kept exported so external tooling / historical
 * imports still resolve. Prefer `MULTI_ASSET_MAINNET_CONTRACT_ID` in
 * new code.
 * @deprecated Use `MULTI_ASSET_MAINNET_CONTRACT_ID`.
 */
export const MULTI_ASSET_TESTNET_CONTRACT_ID = MULTI_ASSET_MAINNET_CONTRACT_ID;

/** True once the placeholder has been replaced with a real contract id. */
export function isBetaContractDeployed(): boolean {
  return (
    MULTI_ASSET_MAINNET_CONTRACT_ID.startsWith("C") &&
    MULTI_ASSET_MAINNET_CONTRACT_ID.length === 56
  );
}

export interface BetaStatus {
  deployed: boolean;
  contractId: string;
  network: "mainnet";
  explorerUrl: string | null;
}

export const MULTI_ASSET_BETA_STATUS: BetaStatus = {
  deployed: isBetaContractDeployed(),
  contractId: MULTI_ASSET_MAINNET_CONTRACT_ID,
  network: "mainnet",
  explorerUrl: isBetaContractDeployed()
    ? `https://stellar.expert/explorer/public/contract/${MULTI_ASSET_MAINNET_CONTRACT_ID}`
    : null,
};
