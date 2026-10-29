// @CONTEXT: Soroban writes return a Vault (for parity with the REST client/IVaultClient interface) but also produce a tx hash + explorer URL the UI wants to surface; rather than threading receipts through every screen, they're published on this module-level subscriber bus, which `<TxReceiptBanner />` listens to. A module-level bus (not React context) keeps stellar-sdk out of the cold-start bundle and avoids unrelated rerenders since receipts aren't part of any component's data shape.

import { getActiveDeployment } from "@/src/wallet/contract-config";

export type SorobanMethod =
  | "create_vault"
  | "deposit"
  | "extend_lock"
  | "withdraw"
  // @CONTEXT: restores an archived contract data entry (RestoreFootprint) and/or bumps its TTL (ExtendFootprintTtl); modeled as a single receipt category since both ops are submitted back-to-back in the same wake-up flow and the user thinks of them as one action
  | "wake_up";

export type TxStatus = "success" | "pending" | "failed";

export interface TxReceipt {
  method: SorobanMethod;
  txHash: string;
  ledger?: number;
  explorerUrl: string;
  status: TxStatus;
  /** Wall-clock time the receipt was emitted (ms). */
  emittedAt: number;
}

type Listener = (r: TxReceipt) => void;

const listeners = new Set<Listener>();

export function emitReceipt(r: TxReceipt): void {
  for (const fn of listeners) {
    try {
      fn(r);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeReceipts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function explorerForTx(txHash: string): string {
  // @CONTEXT: resolves at call time so the explorer link follows the active network (testnet vs mainnet base URL, see contract-config.ts)
  return `${getActiveDeployment().explorerTxBase}${txHash}`;
}

export function methodLabel(m: SorobanMethod, status: TxStatus = "success"): string {
  if (status === "pending") {
    switch (m) {
      case "create_vault":
        return "Vault creation pending…";
      case "deposit":
        return "Deposit pending…";
      case "extend_lock":
        return "Extend pending…";
      case "withdraw":
        return "Withdrawal pending…";
      case "wake_up":
        return "Waking vault pending…";
    }
  }
  if (status === "failed") {
    switch (m) {
      case "create_vault":
        return "Vault creation failed";
      case "deposit":
        return "Deposit failed";
      case "extend_lock":
        return "Extend failed";
      case "withdraw":
        return "Withdrawal failed";
      case "wake_up":
        return "Wake-up failed";
    }
  }
  switch (m) {
    case "create_vault":
      return "Vault created";
    case "deposit":
      return "Deposit confirmed";
    case "extend_lock":
      return "Lock extended";
    case "withdraw":
      return "Withdrawal confirmed";
    case "wake_up":
      return "Vault woken up";
  }
}
