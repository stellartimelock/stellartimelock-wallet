// Stellar payment broadcast — re-checks memo gate and destination as defense-in-depth.

import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import { getActiveDeployment } from "@/src/wallet/contract-config";
import { type StellarKeypair } from "@/src/wallet/stellar";
import {
  fetchFeeStats,
  recommendedMaxFeeStroops,
} from "@/src/wallet/network-fee";
import { wipeKeypair } from "@/src/security/secure-wipe";
import { checkExchangeMemo, accountRequiresMemo } from "@/src/send/exchange-memo-gate";
import { loadKnownDeposits } from "@/src/swap/deposit-registry";

/**
 * Destination categories that REQUIRE a memo for the deposit to be
 * credited on the receiving platform. Sending without a memo to one
 * of these is the #1 way users lose funds to centralised platforms —
 * the tx confirms on-chain but the platform has no way to route the
 * credit, and many of them refuse to return the deposit.
 *
 * This is the ONLY authoritative memo gate. The
 * Send screen mirrors it in the UI; the broadcast helper re-checks
 * it as defense-in-depth. No automated tier / risk resolution runs
 * on this path anymore.
 */
export type SendKindId = "private" | "exchange" | "casino" | "donation";


/**
 * Thrown when the resolved tier indicates a hard-block.
 *
 * The UI should NEVER let this propagate — its existence is an extra
 * runtime guarantee that even with a UI regression we can't sign a
 * forbidden transaction.
 */

export interface BroadcastResult {
  ok: true;
  hash: string;
  ledger: number;
}

export interface BroadcastFailure {
  ok: false;
  /** Short canonical reason — drive UI copy off this. */
  code:
    | "blocked_destination"
    | "invalid_input"
    | "account_not_found"
    | "underfunded"
    | "tx_failed"
    | "network_error";
  /** Human-readable detail — surface verbatim to the user. */
  message: string;
  /** Raw upstream error for diagnostics (NOT for direct UI use). */
  raw?: unknown;
}

export type BroadcastOutcome = BroadcastResult | BroadcastFailure;


/**
 * Broadcast a native XLM payment to mainnet (or testnet — whichever
 * network is currently active in the deployment config).
 */
export async function broadcastPayment(opts: {
  keypair: StellarKeypair;
  destination: string;
  amountXlm: number;
  memo: string;
  /**
   * Self-classification chip selected on the Send screen. Used here to
   * enforce the MANDATORY MEMO GATE for exchange / casino destinations —
   * the same rule the UI mirrors, repeated here as a defense-in-depth
   * guard so a UI regression can never accidentally sign a memo-less tx
   * to a centralised platform. Default "private" preserves backwards
   * compatibility for callers that haven't been updated yet.
   */
  kindId?: SendKindId;
  /**
   * Swap auto-send: the memo the exchange returned for this deposit.
   * When set (even to null/""), the memo must match it exactly or nothing
   * is signed. Leave undefined for ordinary sends.
   */
  requiredMemo?: string | null;
}): Promise<BroadcastOutcome> {
  const kindId = opts.kindId ?? "private";
  // Exchange memo hard block (see src/send/exchange-memo-gate.ts): kind
  // chip, swap-required memo, and any swap deposit address this wallet
  // created. Re-checked below once the destination's SEP-29 flag is known.
  const knownDeposits = await loadKnownDeposits();
  const gateEarly = checkExchangeMemo({
    destination: opts.destination ?? "",
    memo: opts.memo ?? "",
    kindId,
    knownDeposits,
    requiredMemo: opts.requiredMemo,
  });
  if (!gateEarly.ok) {
    return { ok: false, code: "blocked_destination", message: gateEarly.message };
  }

  if (!opts.destination || opts.destination.length !== 56) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Destination address is not a valid 56-character Stellar address.",
    };
  }
  if (!Number.isFinite(opts.amountXlm) || opts.amountXlm <= 0) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Amount must be a positive number.",
    };
  }
  // Stellar enforces a max of 7 decimal places. Round-trip through
  // toFixed to make sure we don't blow up the SDK's amount parser.
  const amountString = opts.amountXlm.toFixed(7);

  let sdkKeypair: Keypair;
  try {
    sdkKeypair = keypairIfUnlocked(opts.keypair.secretSeed);
  } catch (e) {
    return {
      ok: false,
      code: "invalid_input",
      message: "Could not derive signer from secret seed.",
      raw: e,
    };
  }
  if (sdkKeypair.publicKey() !== opts.keypair.publicKey) {
    // Catastrophic — the seed and pubkey we stored disagree. Refuse.
    return {
      ok: false,
      code: "invalid_input",
      message:
        "Stored public key does not match the secret seed — refusing to sign. " +
        "Please reconnect your wallet.",
    };
  }

  const dep = getActiveDeployment();
  const horizonBase = dep.horizonUrl.replace(/\/+$/, "");
  let sequence: string;
  try {
    const accountResp = await fetch(`${horizonBase}/accounts/${opts.keypair.publicKey}`);
    if (accountResp.status === 404) {
      return {
        ok: false,
        code: "account_not_found",
        message:
          "Your account does not exist on the network yet. Receive at least " +
          "1 XLM to activate it before sending.",
      };
    }
    if (!accountResp.ok) {
      return {
        ok: false,
        code: "network_error",
        message: `Horizon returned HTTP ${accountResp.status} loading your account.`,
        raw: accountResp.status,
      };
    }
    const accountJson = await accountResp.json();
    sequence = String(accountJson.sequence);
  } catch (e) {
    return {
      ok: false,
      code: "network_error",
      message: "Could not reach Horizon to read your account sequence.",
      raw: e,
    };
  }

  // Unfunded destinations need CreateAccount (Payment returns op_no_destination).
  // Valid G-addresses are allowed even if they don't exist on-chain yet —
  // Stellar's 1 XLM base reserve is enforced by the network, not as an app hard-block.
  let destinationExists = true;
  let destinationRequiresMemo = false;
  try {
    const destResp = await fetch(`${horizonBase}/accounts/${opts.destination}`);
    if (destResp.status === 404) {
      destinationExists = false;
    } else if (destResp.ok) {
      try {
        const destJson = await destResp.json();
        destinationRequiresMemo = accountRequiresMemo(destJson?.data);
      } catch {
        destinationRequiresMemo = false;
      }
    } else if (!destResp.ok) {
      // Ambiguous Horizon failure — fall through with Payment; submit
      // error handling still covers op_no_destination as a last resort.
      destinationExists = true;
    }
  } catch {
    destinationExists = true;
  }

  if (destinationRequiresMemo) {
    const gate = checkExchangeMemo({
      destination: opts.destination,
      memo: opts.memo ?? "",
      kindId,
      knownDeposits,
      destinationRequiresMemo: true,
      requiredMemo: opts.requiredMemo,
    });
    if (!gate.ok) {
      return { ok: false, code: "blocked_destination", message: gate.message };
    }
  }

  let dynamicMaxFee: string;
  try {
    const snap = await fetchFeeStats();
    dynamicMaxFee = recommendedMaxFeeStroops(snap);
  } catch {
    dynamicMaxFee = String(Math.max(parseInt(BASE_FEE, 10) * 10, 1000));
  }

  let signedXdr: string;
  try {
    const sourceAccount = new Account(opts.keypair.publicKey, sequence);
    const builder = new TransactionBuilder(sourceAccount, {
      // Dynamic maxFee scales with congestion; validator only charges winning bid.
      fee: dynamicMaxFee,
      networkPassphrase: dep.networkPassphrase,
    }).addOperation(
      destinationExists
        ? Operation.payment({
            destination: opts.destination,
            asset: Asset.native(),
            amount: amountString,
          })
        : Operation.createAccount({
            destination: opts.destination,
            startingBalance: amountString,
          }),
    );
    const trimmedMemo = opts.memo.trim();
    if (trimmedMemo.length > 0) {
      // Memo.text is limited to 28 bytes (UTF-8). The form caps the
      // input at 28 chars but multi-byte sequences could overshoot —
      // the SDK throws; we surface a clean error to the user.
      builder.addMemo(Memo.text(trimmedMemo));
    }
    // 60-second timeout means the tx must be ingested within 60s of
    // local clock — protects against rebroadcast-on-rejection races.
    builder.setTimeout(60);

    const tx = builder.build();
    tx.sign(sdkKeypair);
    signedXdr = tx.toXDR();
    wipeKeypair(sdkKeypair);
  } catch (e) {
    // Best-effort wipe on the failure path too; the Keypair may
    // still hold the seed if the SDK threw AFTER constructing but
    // BEFORE signing.
    wipeKeypair(sdkKeypair);
    return {
      ok: false,
      code: "invalid_input",
      message:
        e instanceof Error
          ? `Could not build the transaction: ${e.message}`
          : "Could not build the transaction.",
      raw: e,
    };
  }

  try {
    // Raw fetch keeps bundle slim vs SDK Horizon.Server.submitTransaction.
    const form = new URLSearchParams();
    form.set("tx", signedXdr);
    const submitResp = await fetch(`${horizonBase}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const submitJson = await submitResp.json();
    if (!submitResp.ok || submitJson.successful === false) {
      // Horizon error shape:
      //   { type, title, status, extras: { result_codes: { transaction, operations[] } } }
      const codes = submitJson?.extras?.result_codes;
      const tx_code = codes?.transaction;
      const op_code = codes?.operations?.[0];
      let code: BroadcastFailure["code"] = "tx_failed";
      let message =
        submitJson?.title || submitJson?.detail || "Stellar network rejected the transaction.";
      if (tx_code === "tx_insufficient_balance" || op_code === "op_underfunded") {
        code = "underfunded";
        message =
          "Insufficient balance — remember Stellar requires keeping a 1 XLM minimum " +
          "reserve plus 0.5 XLM per trustline / signer / offer.";
      } else if (op_code === "op_no_destination") {
        // Race: account vanished between our Horizon probe and submit.
        // Surface a soft message — caller can retry; CreateAccount path
        // should have prevented this for fresh destinations.
        code = "tx_failed";
        message =
          "The destination account does not exist yet. Retry — the next attempt " +
          "will create it (Stellar requires ~1 XLM minimum to activate a new account).";
      } else if (op_code === "op_already_exists") {
        code = "tx_failed";
        message =
          "The destination account was just activated. Tap Try again to send as a normal payment.";
      } else if (op_code === "op_low_reserve") {
        code = "underfunded";
        message =
          "Amount is below Stellar's minimum to create a new account (~1 XLM). " +
          "Increase the amount and try again.";
      }
      return {
        ok: false,
        code,
        message,
        raw: { tx_code, op_code, full: submitJson },
      };
    }
    return {
      ok: true,
      hash: String(submitJson.hash),
      ledger: Number(submitJson.ledger ?? 0),
    };
  } catch (e) {
    return {
      ok: false,
      code: "network_error",
      message: "Could not reach Horizon to submit the transaction.",
      raw: e,
    };
  }
}

// Re-exported for tree-shaking if a future call site needs Horizon.Server.
export { Horizon };
