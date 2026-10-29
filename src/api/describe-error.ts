// @CONTEXT: translates any error thrown by the active IVaultClient into a friendly user message regardless of which backend the toggle routes to — REST errors are already strings (FastAPI mirror's `detail`), Soroban errors are categorised SorobanError instances with a `userMessage` field, everything else falls back to `e.message`/`String(e)`. Includes txHash so screens can offer a "View on explorer" affordance when the failure is from a tx that did make it on-chain.

import { SorobanError } from "@/src/api/soroban-errors";

export interface FriendlyError {
  message: string;
  txHash?: string;
  retryable: boolean;
}

export function describeError(e: unknown): FriendlyError {
  if (e instanceof SorobanError) {
    return {
      message: e.userMessage,
      txHash: e.txHash,
      retryable: e.retryable,
    };
  }
  if (e instanceof Error) {
    return { message: e.message || "Something went wrong.", retryable: false };
  }
  return { message: String(e) || "Something went wrong.", retryable: false };
}
