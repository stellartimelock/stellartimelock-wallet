// Multi-Asset Vault — Mainnet BETA feature module barrel.

export {
  MULTI_ASSET_MAINNET_CONTRACT_ID,
  MULTI_ASSET_TESTNET_CONTRACT_ID,
  MULTI_ASSET_BETA_STATUS,
  isMultiAssetBetaEnabled,
} from "@/src/wallet/multi-asset-beta/contract-config";
export { MultiAssetBetaToggle } from
  "@/src/wallet/multi-asset-beta/MultiAssetBetaToggle";
export {
  TokenPicker,
  isValidContractAddress,
  tokenSymbolForAddress,
  isNativeXlmAddress,
  NATIVE_XLM_MAINNET_SAC,
  KNOWN_MAINNET_TOKENS,
} from "@/src/wallet/multi-asset-beta/TokenPicker";
export {
  createBetaVault,
  listBetaOwned,
  listBetaVaults,
  getBetaVault,
  checkTrustLine,
  withdrawBetaVault,
  humanizeBetaError,
  isTrustLineError,
} from "@/src/wallet/multi-asset-beta/client";
export type { BetaVaultRecord } from "@/src/wallet/multi-asset-beta/client";
export {
  checkAndBumpBetaTtl,
  getVaultTtlStatus,
  preflightVaultTtlBump,
  submitPreflightedTtlBump,
  stroopsToXlmString,
  recordTtlRenewal,
  listTtlRenewals,
  TTL_WARNING_WINDOW_HOURS,
} from "@/src/wallet/multi-asset-beta/ttl-keepalive";
export type {
  TtlBumpResult,
  VaultTtlStatus,
  TtlBumpPreflight,
  TtlBumpSubmitResult,
  TtlRenewalLogEntry,
} from "@/src/wallet/multi-asset-beta/ttl-keepalive";
