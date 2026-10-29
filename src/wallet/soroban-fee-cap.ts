// Cap the fee a Soroban RPC can talk this wallet into signing.
// assembleTransaction adds the RPC's minResourceFee to the transaction.
// A hostile or compromised RPC can otherwise set that fee to the whole balance.
// The fee is burned by the network, so the loss is real even though it is not a transfer.

import { Transaction, rpc as StellarRpc } from "@stellar/stellar-sdk";

/** 10 XLM. Above real vault invokes, below an account-draining fee. */
export const MAX_SOROBAN_FEE_STROOPS = 100_000_000n;

export function assertSorobanFeeWithinCap(feeStroops: string): void {
  if (!/^\d+$/.test(feeStroops)) {
    throw new Error("Soroban fee is not a stroop count. Refusing to sign.");
  }
  const fee = BigInt(feeStroops);
  if (fee > MAX_SOROBAN_FEE_STROOPS) {
    throw new Error(
      `Soroban fee is above the 10 XLM cap (${feeStroops} stroops). Refusing to sign.`,
    );
  }
}

function hostFunctionXdr(tx: Transaction): string | null {
  const op = tx.operations[0] as { type?: string; func?: { toXDR?: (format: string) => string } } | undefined;
  if (!op || op.type !== "invokeHostFunction" || typeof op.func?.toXDR !== "function") {
    return null;
  }
  return op.func.toXDR("base64");
}

function assertHostFunctionUnchanged(before: Transaction, after: Transaction): void {
  const left = hostFunctionXdr(before);
  if (left == null) return;
  if (hostFunctionXdr(after) !== left) {
    throw new Error("Soroban simulation changed the contract call. Refusing to sign.");
  }
}

export function assembleCappedSorobanTx(
  raw: Transaction,
  simulation: Parameters<typeof StellarRpc.assembleTransaction>[1],
): Transaction {
  const assembled = StellarRpc.assembleTransaction(raw, simulation).build();
  assertSorobanFeeWithinCap(assembled.fee);
  assertHostFunctionUnchanged(raw, assembled);
  return assembled;
}
