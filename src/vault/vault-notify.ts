/**
 * Send a vault-discovery notification payment to a counterparty.
 *
 * 0.0001 XLM + vault memo is enough for the recipient's wallet to discover
 * the multi-party vault by scanning their own Horizon history — no backend.
 */

import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import {
  formatVaultMemo,
  isContractRef,
  isVaultIdRef,
  VAULT_NOTIFY_AMOUNT_XLM,
} from "@/src/vault/memo-format";
import { getActiveDeployment } from "@/src/wallet/contract-config";
import {
  fetchFeeStats,
  recommendedMaxFeeStroops,
} from "@/src/wallet/network-fee";
import { wipeKeypair } from "@/src/security/secure-wipe";
import type { StellarKeypair } from "@/src/wallet/stellar";

export type VaultNotifyKind = "DeadManSwitch" | "MultiSig";

export interface VaultNotifyInput {
  keypair: StellarKeypair;
  /** Counterparty G-address (beneficiary or co-signer). */
  destination: string;
  /**
   * Vault reference:
   *   - Multi-Sig → deployed contract C-address
   *   - Dead Man's Switch → vault id as decimal string
   */
  vaultRef: string;
  kind: VaultNotifyKind;
}

export interface VaultNotifyResult {
  ok: boolean;
  hash?: string;
  /** Logical memo shown to the user (STL:VAULT:<ref>). */
  logicalMemo: string;
  error?: string;
}

/**
 * Build the on-chain Memo for a vault notification.
 * Multi-Sig uses MEMO_HASH (C-address won't fit in 28-byte text).
 * Dead Man's Switch uses MEMO_TEXT "STL:VAULT:<vaultId>".
 */
export function buildVaultNotifyMemo(vaultRef: string): Memo {
  const ref = vaultRef.trim();
  if (isContractRef(ref)) {
    // C-address won't fit in 28-byte MEMO_TEXT — encode raw 32-byte id as MEMO_HASH.
    const decode =
      typeof (StrKey as { decodeContract?: (s: string) => Buffer }).decodeContract ===
      "function"
        ? (StrKey as { decodeContract: (s: string) => Buffer }).decodeContract
        : null;
    if (!decode) {
      throw new Error("Stellar SDK missing StrKey.decodeContract.");
    }
    const raw = decode(ref);
    return Memo.hash(Buffer.from(raw));
  }
  if (isVaultIdRef(ref)) {
    const text = formatVaultMemo(ref);
    if (Buffer.byteLength(text, "utf8") > 28) {
      throw new Error("Vault memo exceeds Stellar MEMO_TEXT 28-byte limit.");
    }
    return Memo.text(text);
  }
  throw new Error("Vault ref must be a C-address or decimal vault id.");
}

/**
 * Broadcast the 0.0001 XLM notification payment. Caller is responsible for
 * showing a confirm UI first — this signs and submits immediately.
 */
export async function sendVaultNotifyPayment(
  input: VaultNotifyInput,
): Promise<VaultNotifyResult> {
  const logicalMemo = formatVaultMemo(input.vaultRef);
  const dest = input.destination.trim();
  if (!StrKey.isValidEd25519PublicKey(dest)) {
    return { ok: false, logicalMemo, error: "Destination is not a valid Stellar address." };
  }
  if (dest === input.keypair.publicKey) {
    return { ok: false, logicalMemo, error: "Cannot notify your own address." };
  }

  let memo: Memo;
  try {
    memo = buildVaultNotifyMemo(input.vaultRef);
  } catch (e) {
    return {
      ok: false,
      logicalMemo,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  let sdkKeypair: Keypair;
  try {
    sdkKeypair = keypairIfUnlocked(input.keypair.secretSeed);
  } catch (e) {
    return {
      ok: false,
      logicalMemo,
      error: "Could not derive signer from secret seed.",
    };
  }

  const dep = getActiveDeployment();
  const horizonBase = dep.horizonUrl.replace(/\/+$/, "");
  const amountString = VAULT_NOTIFY_AMOUNT_XLM.toFixed(7);

  try {
    const accountResp = await fetch(`${horizonBase}/accounts/${input.keypair.publicKey}`);
    if (accountResp.status === 404) {
      return {
        ok: false,
        logicalMemo,
        error: "Your account is not active on the network yet.",
      };
    }
    if (!accountResp.ok) {
      return {
        ok: false,
        logicalMemo,
        error: `Horizon returned HTTP ${accountResp.status}.`,
      };
    }
    const accountJson = (await accountResp.json()) as { sequence: string };
    const sequence = String(accountJson.sequence);

    let dynamicMaxFee: string;
    try {
      const snap = await fetchFeeStats();
      dynamicMaxFee = recommendedMaxFeeStroops(snap);
    } catch {
      dynamicMaxFee = String(Math.max(parseInt(BASE_FEE, 10) * 10, 1000));
    }

    const sourceAccount = new Account(input.keypair.publicKey, sequence);
    const tx = new TransactionBuilder(sourceAccount, {
      fee: dynamicMaxFee,
      networkPassphrase: dep.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: dest,
          asset: Asset.native(),
          amount: amountString,
        }),
      )
      .addMemo(memo)
      .setTimeout(60)
      .build();

    tx.sign(sdkKeypair);
    const signedXdr = tx.toXDR();
    wipeKeypair(sdkKeypair);

    const submit = await fetch(`${horizonBase}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `tx=${encodeURIComponent(signedXdr)}`,
    });
    const body = (await submit.json().catch(() => ({}))) as {
      hash?: string;
      title?: string;
      detail?: string;
      extras?: { result_codes?: unknown };
    };
    if (!submit.ok) {
      const detail =
        body.detail ||
        body.title ||
        (body.extras ? JSON.stringify(body.extras.result_codes) : null) ||
        `Horizon HTTP ${submit.status}`;
      return { ok: false, logicalMemo, error: detail };
    }
    return { ok: true, hash: body.hash, logicalMemo };
  } catch (e) {
    wipeKeypair(sdkKeypair);
    return {
      ok: false,
      logicalMemo,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
