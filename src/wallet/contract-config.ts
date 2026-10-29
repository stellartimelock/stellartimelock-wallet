// Deployed Soroban contract configuration. Values are public network
// identifiers; no secrets live here. SessionProvider syncs the active
// network via `setActiveNetwork()`; consumers call `getActiveDeployment()`.

export type StellarNetwork = "testnet" | "mainnet";

export interface DeployedContract {
  network: StellarNetwork;
  /**
   * True if this network is actually deployed and the app is allowed to
   * route writes here. Mainnet ships with `false` until contract is live.
   */
  enabled: boolean;
  contractId: string;
  /**
   * Primary Soroban RPC endpoint. The mobile runtime starts here on every
   * cold boot. If a request to this URL throws a network error, the client
   * rotates to one of the URLs in `rpcFallbacks` (see
   * `src/wallet/rpc-failover.ts`) and sticks with the first one that
   * answers cleanly until the next cold boot.
   */
  rpcUrl: string;
  /**
   * Ordered list of alternate Soroban RPCs to try when `rpcUrl` is
   * unreachable. The mobile data plane behaves very differently from
   * server-side cloud egress — endpoints that work fine from a colo can
   * be blocked, throttled, or simply slow when called from a residential
   * carrier-NAT, so we ship 2+ endpoints to keep the read path alive.
   * Empty array = no failover.
   */
  rpcFallbacks: string[];
  horizonUrl: string;
  networkPassphrase: string;
  friendbotUrl: string | null; // null on mainnet — no free funding
  /** Wrapped native-XLM Stellar Asset Contract address used by the vault. */
  nativeXlmSac: string;
  /** stellar.expert URL for human inspection. */
  explorerUrl: string;
  /** Base URL used for per-tx explorer links. */
  explorerTxBase: string;
}

export const TESTNET_DEPLOYMENT: DeployedContract = {
  network: "testnet",
  enabled: true,
  contractId: "CBIXRLC5GQ6O5UUJFVRIWZD77P5LUVJG3XGGUVS4EWHAJ6LXQZNKH35Z",
  rpcUrl: "https://soroban-testnet.stellar.org",
  rpcFallbacks: [],
  horizonUrl: "https://horizon-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  friendbotUrl: "https://friendbot.stellar.org",
  nativeXlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorerUrl:
    "https://stellar.expert/explorer/testnet/contract/CBIXRLC5GQ6O5UUJFVRIWZD77P5LUVJG3XGGUVS4EWHAJ6LXQZNKH35Z",
  explorerTxBase: "https://stellar.expert/explorer/testnet/tx/",
};

// Mainnet deployment — LIVE.
//
// Deployment provenance (June 2026, burner deployer):
//   - Upload + deploy tx: https://stellar.expert/explorer/public/tx/3965de1399e61ac97100e9ed812b59a73f1c79c470b07559a252c10593243cb0
//   - WASM bytecode hash: eb2e8262657c60520b23c1a02e329257a8cca512329efa30c9c72db6fd799680
//   - init(token=CAS3J7...XOWMA) tx: https://stellar.expert/explorer/public/tx/1cc41dc374738aa3103f931c79f396f5337220748e538696541cd07813986a06
//   - Deployer: GBP4L2GO6OELSA6DBGMFVAWI5Z57CRYBEVWNTABOZ2CTCT23T2ALS37Y (burner — fully spent post-deploy)
export const MAINNET_DEPLOYMENT: DeployedContract = {
  network: "mainnet",
  enabled: true,
  contractId: "CCWDMIPD4ZTTIV5LR53PD325MS6VRGF3WJEJRKNCIKK3G7H6AXJ3UE4F",
  // RPC order tuned for mobile-carrier egress; creit.tech demoted after
  // soak-test stalls on first call. See `src/wallet/rpc-failover.ts`.
  rpcUrl: "https://rpc.ankr.com/stellar_soroban",
  rpcFallbacks: [
    "https://stellar-soroban-public.nodies.app",
    "https://mainnet.stellar.nova-node.xyz",
    "https://soroban-rpc.stellar.org",
    "https://mainnet.sorobanrpc.com",
    "https://soroban-rpc.creit.tech",
  ],
  horizonUrl: "https://horizon.stellar.org",
  networkPassphrase: "Public Global Stellar Network ; September 2015",
  friendbotUrl: null,
  nativeXlmSac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
  explorerUrl:
    "https://stellar.expert/explorer/public/contract/CCWDMIPD4ZTTIV5LR53PD325MS6VRGF3WJEJRKNCIKK3G7H6AXJ3UE4F",
  explorerTxBase: "https://stellar.expert/explorer/public/tx/",
};

const DEPLOYMENTS: Record<StellarNetwork, DeployedContract> = {
  testnet: TESTNET_DEPLOYMENT,
  mainnet: MAINNET_DEPLOYMENT,
};

let _activeNetwork: StellarNetwork = "mainnet";
type ActiveNetworkListener = (n: StellarNetwork) => void;
const _listeners = new Set<ActiveNetworkListener>();

/**
 * Set the active Stellar network. Throws if the requested network is not
 * marked `enabled` in its `DeployedContract` block, which prevents anyone
 * from accidentally enabling mainnet writes before the placeholder address
 * has been replaced.
 */
export function setActiveNetwork(n: StellarNetwork): void {
  const d = DEPLOYMENTS[n];
  if (!d.enabled) {
    throw new Error(
      `Stellar ${n} is not yet deployed for XLM Vault. Update ` +
        `src/wallet/contract-config.ts with the real contract id and flip ` +
        `enabled: true. See /app/contracts/xlm_vault/DEPLOYMENT.md.`,
    );
  }
  _activeNetwork = n;
  for (const fn of _listeners) {
    try {
      fn(n);
    } catch {
      /* subscribers must not break the publisher */
    }
  }
}

/** Subscribe to active-network changes. Returns an unsubscribe function. */
export function subscribeActiveNetwork(fn: ActiveNetworkListener): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** The active network name (always one of the keys in DEPLOYMENTS). */
export function getActiveNetwork(): StellarNetwork {
  return _activeNetwork;
}

/**
 * The active deployment record. Use this in every non-React module that
 * previously imported TESTNET_DEPLOYMENT directly.
 */
export function getActiveDeployment(): DeployedContract {
  return DEPLOYMENTS[_activeNetwork];
}

/**
 * Resolve a deployment by name. Throws if the network is not enabled —
 * callers should check `enabled` before invoking writes.
 */
export function deploymentFor(network: StellarNetwork): DeployedContract {
  const d = DEPLOYMENTS[network];
  if (!d.enabled) {
    throw new Error(
      `Stellar ${network} is not yet deployed for XLM Vault. ` +
        `See /app/PRODUCTION_RUNBOOK.md for rollout steps.`,
    );
  }
  return d;
}

/** All networks that are currently enabled. Used by the Settings picker. */
export function enabledNetworks(): DeployedContract[] {
  return [TESTNET_DEPLOYMENT, MAINNET_DEPLOYMENT].filter((d) => d.enabled);
}

/** All declared networks (regardless of enabled). Used by Settings to show
 *  a "coming soon" row for mainnet so users know it exists. */
export function allDeclaredNetworks(): DeployedContract[] {
  return [TESTNET_DEPLOYMENT, MAINNET_DEPLOYMENT];
}
