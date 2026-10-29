// Sign a tap-to-pay transaction after a biometric check.
//
// The biometric result only decides whether this function may read the
// seed-derived Stellar key. The key is not encrypted to the device, the
// biometric hardware, or a SecureStore root. Payment history stays plain JSON.

import { authenticate } from "@/src/security/biometric";
import { loadSigningKeypair } from "@/src/wallet/stellar";

import { submitTapPayment, type TapSubmitResult } from "./horizon-pay";

export async function signTapPaymentAfterBiometric(opts: {
  destination: string;
  amount: string;
  memo: string;
  horizonUrl: string;
  networkPassphrase: string;
  prompt: string;
  /** Re-checked after the biometric prompt and before the seed is read. */
  confirmStillSafe?: () => boolean;
}): Promise<TapSubmitResult> {
  const allowed = await authenticate(opts.prompt);
  if (!allowed) {
    return {
      ok: false,
      code: "biometric_failed",
      message: "Biometric confirmation was canceled. Nothing was signed.",
    };
  }
  if (opts.confirmStillSafe && !opts.confirmStillSafe()) {
    return {
      ok: false,
      code: "invalid_input",
      message: "This payment expired or the network changed. Nothing was signed.",
    };
  }
  const keypair = await loadSigningKeypair();
  if (!keypair?.secretSeed) {
    return {
      ok: false,
      code: "no_key",
      message: "Add a wallet seed before paying.",
    };
  }
  return submitTapPayment({
    sourceSecret: keypair.secretSeed,
    destination: opts.destination,
    amount: opts.amount,
    memo: opts.memo,
    horizonUrl: opts.horizonUrl,
    networkPassphrase: opts.networkPassphrase,
  });
}
