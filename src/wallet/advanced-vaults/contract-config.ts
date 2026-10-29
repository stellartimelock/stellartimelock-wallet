// Advanced Vaults — contract config (Cooling-Off, Vesting Schedule, Dead Man's Switch)
//
// Self-contained BETA module for the `multi_asset_vault_v2` Soroban
// contract. Deliberately DECOUPLED from the app's hard-locked Mainnet
// network (see src/state/session.tsx — the standard wallet/vault flow is
// pinned to Mainnet). This lets us exercise the three brand-new vault
// kinds on Stellar TESTNET first, without putting the user's real funds
// at risk, before a single final Mainnet deployment.
//
// Deployment provenance — Testnet (2026-07-20, `deployer-mav-v2` identity):
//   - Contract id : CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV
//   - Explorer    : https://stellar.expert/explorer/testnet/contract/CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV
//   - Smoke-tested on-chain: create + cooling-off initiate/cancel/withdraw,
//     vesting-schedule linear unlock + partial withdraw, dead man's switch ping +
//     backup claim. All verified successful directly against the deployed
//     contract (see vault ids 0/1/2 on testnet).
//
// Deployment provenance — Mainnet: NOT YET DEPLOYED. `MAINNET.contractId`
// is filled in the moment `/app/contracts/multi_asset_vault_v2/deploy.sh
// --mainnet` runs and this file's `ACTIVE_NETWORK` flips to `"mainnet"`.

export type AdvancedVaultKind =
  | "TimeLock"
  | "CoolingOff"
  | "Vesting"
  | "DeadManSwitch"
  | "MultiSig"
  /** Vesting schedule that works with non-XLM tokens (Stellar SACs). */
  | "MultiAssetVesting"
  | "HTLC";

/**
 * HTLC (Hash Time-Locked Contract) — dedicated deployment, separate from mav_v2.
 * Live on Stellar Mainnet.
 */
export interface HtlcDeployment {
  /** C-address of the shared HTLC contract on Mainnet. */
  contractId: string;
  /** Hex SHA-256 of the uploaded HTLC WASM on Mainnet. */
  wasmHash: string;
  /** Wrapped native-XLM SAC used for locks. */
  nativeXlmSac: string;
}

// Deployment provenance — Mainnet:
//   - Contract id : CDPWT5VY4YFBUKUTZ7LKQNQ3FVJE5VSKJJD4LFBLUY4VSYYSHKAUTRCH
//   - WASM hash    : 0fb3760c222c362975089dc1d0fd09b47d114793f22b1aa70c02e9da7671e284
const HTLC_CONTRACT_ID = "CDPWT5VY4YFBUKUTZ7LKQNQ3FVJE5VSKJJD4LFBLUY4VSYYSHKAUTRCH";
const HTLC_WASM_HASH = "0fb3760c222c362975089dc1d0fd09b47d114793f22b1aa70c02e9da7671e284";

export function getHtlcDeployment(): HtlcDeployment {
  const dep = getAdvancedDeployment();
  return {
    contractId: HTLC_CONTRACT_ID,
    wasmHash: HTLC_WASM_HASH,
    nativeXlmSac: dep.nativeXlmSac,
  };
}

/** True once both contract id and WASM hash are configured (Mainnet live). */
export function isHtlcContractDeployed(): boolean {
  const h = getHtlcDeployment();
  return (
    h.contractId.startsWith("C") &&
    h.contractId.length === 56 &&
    /^[0-9a-fA-F]{64}$/.test(h.wasmHash)
  );
}

/** Dual-Approval Vault — per-vault contract deployed from uploaded WASM.
 *  The `wasmHash` is the pre-uploaded contract code hash (uploaded once
 *  at deploy time). Each MultiSig vault creation deploys a fresh contract
 *  instance from this hash, then calls `initialize()` on it. */
export interface DualApprovalDeployment {
  /** Hex-encoded SHA-256 hash of the uploaded Dual Approval WASM. */
  wasmHash: string;
  /** Stellar address of the XLM SAC (native token). */
  nativeXlmSac: string;
}

export type AdvancedNetworkName = "testnet" | "mainnet";

export interface AdvancedDeployment {
  network: AdvancedNetworkName;
  enabled: boolean;
  contractId: string;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  /** null on mainnet — no free funding there. */
  friendbotUrl: string | null;
  /** Wrapped native-XLM Stellar Asset Contract address on this network. */
  nativeXlmSac: string;
  explorerUrl: string;
}

const TESTNET: AdvancedDeployment = {
  network: "testnet",
  enabled: true,
  contractId: "CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  friendbotUrl: "https://friendbot.stellar.org",
  nativeXlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorerUrl:
    "https://stellar.expert/explorer/testnet/contract/CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV",
};

// Filled automatically the moment the final single Mainnet deploy runs.
//
// Deployment provenance — Mainnet (2026-07-20, `mainnet-deployer` identity):
//   - Contract id : CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM
//   - Explorer    : https://stellar.expert/explorer/public/contract/CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM
//   - Wasm upload tx : 08861df343ac4c75ea4bad3a6b7c789661e6403029354bc732b65b28effa4d12
//   - Create tx      : 781abfa997238276826fae212318df29f4d043a4a84aeb655da23fc31172e6ae
//   - Interface verified on-chain to match multi_asset_vault_v2/src/lib.rs.
const MAINNET: AdvancedDeployment = {
  network: "mainnet",
  enabled: true,
  contractId: "CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM",
  rpcUrl: "https://rpc.ankr.com/stellar_soroban",
  horizonUrl: "https://horizon.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  friendbotUrl: null,
  nativeXlmSac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  explorerUrl:
    "https://stellar.expert/explorer/public/contract/CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM",
};

// Dual-Approval Vault — WASM config
//
// The Dual-Approval Vault is a per-vault contract (one instance per vault).
// The WASM was built from /app/contracts/dual_approval_vault/ and must be
// uploaded to Mainnet before the first creation.
//
// Deployment provenance — Mainnet (2026-07-26):
//   - WASM built : 22,486 bytes, SHA256 703fc35c4823b3becf7ae010e2951da1e4a259d5ec46dd2b85edc7b0151b71c5
//   - WASM upload tx : <PENDING — must run stellar contract upload before first create>
//   - Each vault creation deploys a fresh instance from the uploaded wasmHash.
//     See createMultiSigVault() in client.ts for the deploy+initialize flow.
//
// Testnet config — same WASM, different RPC. The testnet flag is also
// gated through `ACTIVE_NETWORK` so all calls go to the right network.
const DUAL_APPROVAL_WASM_HASH = "703fc35c4823b3becf7ae010e2951da1e4a259d5ec46dd2b85edc7b0151b71c5";

// Single-line flip — now that Mainnet is deployed and verified, this
// controls whether the Advanced Vaults feature uses real Mainnet funds
// or stays on the free Testnet sandbox.
//
// LIVE as of 2026-07-20 — user explicitly confirmed go-live after
// reviewing the verified Mainnet contract id + cost. Every Advanced
// Vault create/action call now moves real XLM.
const ACTIVE_NETWORK: AdvancedNetworkName = "mainnet";

export function getAdvancedDeployment(): AdvancedDeployment {
  return ACTIVE_NETWORK === "mainnet" ? MAINNET : TESTNET;
}

export function getAdvancedNetworkName(): AdvancedNetworkName {
  return ACTIVE_NETWORK;
}

export function isAdvancedVaultsDeployed(): boolean {
  const d = getAdvancedDeployment();
  return d.enabled && d.contractId.startsWith("C") && d.contractId.length === 56;
}

export function getDualApprovalConfig(): DualApprovalDeployment {
  const dep = getAdvancedDeployment();
  return {
    wasmHash: DUAL_APPROVAL_WASM_HASH,
    nativeXlmSac: dep.nativeXlmSac,
  };
}

export function getDualApprovalWasmHash(): string {
  return DUAL_APPROVAL_WASM_HASH;
}

// Icon names are Feather glyphs (Feather has no literal "snowflake" or
// "hourglass" glyph, so the closest visual metaphors are used instead:
// cloud-snow ~ freeze/cooling, clock ~ gradual time-based unlock).
export const ADVANCED_VAULT_KIND_META: Record<
  Exclude<AdvancedVaultKind, "TimeLock">,
  {
    label: string;
    icon: "cloud-snow" | "clock" | "layers" | "heart" | "users" | "link";
    accent: string;
    comingSoon?: boolean;
  }
> = {
  CoolingOff: { label: "Cooling-Off", icon: "cloud-snow", accent: "#00E5FF" },
  Vesting: { label: "Vesting Schedule", icon: "clock", accent: "#00E5FF" },
  MultiAssetVesting: {
    label: "Multi-Asset Vesting",
    icon: "layers",
    accent: "#00E5FF",
  },
  DeadManSwitch: { label: "Dead Man's Switch", icon: "heart", accent: "#E04545" },
  MultiSig: { label: "Multi-Sig", icon: "users", accent: "#E8B84A" },
  HTLC: {
    label: "HTLC",
    icon: "link",
    accent: "#9B8CFF",
  },
};
