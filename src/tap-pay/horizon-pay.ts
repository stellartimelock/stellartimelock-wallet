// Horizon calls for tap to pay. Every URL is HTTPS on port 443 so the
// request still works on a VPN that only forwards standard web traffic.

import { keypairIfUnlocked } from "@/src/wallet/sign-lock";

import {
  getActiveDeployment,
  MAINNET_DEPLOYMENT,
  type StellarNetwork,
} from "@/src/wallet/contract-config";
import { wipeKeypair } from "@/src/security/secure-wipe";
import { STELLAR_USDC_ISSUER } from "@/src/wallet/horizon";

import { amountsEqual, canonicalAmount } from "./money";
import { buildSignedPayment } from "./tx";

export type TapSubmitResult =
  | { ok: true; hash: string; ledger: number; source: string }
  | {
      ok: false;
      code:
        | "invalid_input"
        | "account_not_found"
        | "underfunded"
        | "tx_failed"
        | "network_error"
        | "https"
        | "biometric_failed"
        | "no_key";
      message: string;
    };

export interface IncomingPayment {
  hash: string;
  from: string;
  ledger: number;
  amount: string;
}

/** Refuse cleartext and any port other than the HTTPS default. */
export function assertHttps443(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Horizon URL is not valid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Horizon must be reached over HTTPS.");
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    throw new Error("Horizon must use port 443.");
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

export function activeHorizon(): { url: string; network: StellarNetwork; passphrase: string } {
  const dep = getActiveDeployment();
  return {
    url: assertHttps443(dep.horizonUrl),
    network: dep.network,
    passphrase: dep.networkPassphrase,
  };
}

export async function fetchMainnetXlmUsd(): Promise<{ usd: number; fetchedAt: number }> {
  const horizon = assertHttps443(MAINNET_DEPLOYMENT.horizonUrl);
  const params = new URLSearchParams({
    selling_asset_type: "native",
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: STELLAR_USDC_ISSUER,
    limit: "1",
  });
  const res = await fetch(`${horizon}/order_book?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Horizon order book returned HTTP ${res.status}.`);
  const json = (await res.json()) as {
    bids?: Array<{ price?: string }>;
    asks?: Array<{ price?: string }>;
  };
  const bid = Number(json.bids?.[0]?.price);
  const ask = Number(json.asks?.[0]?.price);
  if (!(bid > 0) || !(ask > 0)) throw new Error("XLM/USD rate is unavailable.");
  return { usd: (bid + ask) / 2, fetchedAt: Date.now() };
}

async function maxFeeStroops(horizon: string): Promise<string> {
  try {
    const res = await fetch(`${horizon}/fee_stats`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return "1000";
    const json = (await res.json()) as {
      fee_charged?: { p90?: string | number };
      max_fee?: { p90?: string | number };
    };
    const p90 = Number(json.max_fee?.p90 ?? json.fee_charged?.p90 ?? 0);
    const bid = Math.max(1000, Number.isFinite(p90) ? p90 : 0);
    return String(Math.min(bid, 100_000));
  } catch {
    return "1000";
  }
}

export async function submitTapPayment(opts: {
  sourceSecret: string;
  destination: string;
  amount: string;
  memo: string;
  horizonUrl: string;
  networkPassphrase: string;
}): Promise<TapSubmitResult> {
  let horizon: string;
  try {
    horizon = assertHttps443(opts.horizonUrl);
  } catch (e) {
    return {
      ok: false,
      code: "https",
      message: e instanceof Error ? e.message : "Horizon must use HTTPS on port 443.",
    };
  }
  const amount = canonicalAmount(opts.amount);
  if (!amount) {
    return { ok: false, code: "invalid_input", message: "Amount must be a positive XLM amount." };
  }

  let sourcePublic = "";
  try {
    const preview = keypairIfUnlocked(opts.sourceSecret);
    sourcePublic = preview.publicKey();
    wipeKeypair(preview);
  } catch {
    return { ok: false, code: "invalid_input", message: "Could not read the signing key." };
  }

  let sequence = "";
  try {
    const accountResp = await fetch(`${horizon}/accounts/${encodeURIComponent(sourcePublic)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (accountResp.status === 404) {
      return {
        ok: false,
        code: "account_not_found",
        message: "This account is not on the network yet. Receive at least 1 XLM before paying.",
      };
    }
    if (!accountResp.ok) {
      return {
        ok: false,
        code: "network_error",
        message: `Horizon returned HTTP ${accountResp.status} loading the account.`,
      };
    }
    const accountJson = (await accountResp.json()) as { sequence?: string | number };
    sequence = String(accountJson.sequence ?? "");
    if (!/^\d+$/.test(sequence)) {
      return { ok: false, code: "network_error", message: "Horizon did not return an account sequence." };
    }
  } catch {
    return { ok: false, code: "network_error", message: "Could not reach Horizon to read the account." };
  }

  let createAccount = false;
  try {
    const destResp = await fetch(`${horizon}/accounts/${encodeURIComponent(opts.destination)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (destResp.status === 404) createAccount = true;
  } catch {
    createAccount = false;
  }

  let signed: { xdr: string; source: string };
  try {
    signed = buildSignedPayment({
      sourceSecret: opts.sourceSecret,
      sequence,
      destination: opts.destination,
      amount,
      memo: opts.memo,
      networkPassphrase: opts.networkPassphrase,
      feeStroops: await maxFeeStroops(horizon),
      createAccount,
    });
  } catch (e) {
    return {
      ok: false,
      code: "invalid_input",
      message: e instanceof Error ? e.message : "Could not build the transaction.",
    };
  }

  try {
    const form = new URLSearchParams();
    form.set("tx", signed.xdr);
    const submitResp = await fetch(`${horizon}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form.toString(),
    });
    const submitJson = (await submitResp.json()) as {
      hash?: string;
      ledger?: number;
      successful?: boolean;
      title?: string;
      detail?: string;
      extras?: { result_codes?: { transaction?: string; operations?: string[] } };
    };
    if (!submitResp.ok || submitJson.successful === false) {
      const op = submitJson.extras?.result_codes?.operations?.[0];
      const txCode = submitJson.extras?.result_codes?.transaction;
      if (txCode === "tx_insufficient_balance" || op === "op_underfunded" || op === "op_low_reserve") {
        return {
          ok: false,
          code: "underfunded",
          message: "The account does not have enough XLM to send this payment and keep the reserve.",
        };
      }
      return {
        ok: false,
        code: "tx_failed",
        message: submitJson.title || submitJson.detail || "The Stellar network rejected the transaction.",
      };
    }
    return {
      ok: true,
      hash: String(submitJson.hash),
      ledger: Number(submitJson.ledger ?? 0),
      source: signed.source,
    };
  } catch {
    return { ok: false, code: "network_error", message: "Could not reach Horizon to submit the transaction." };
  }
}

export async function fetchHomeDomain(horizonUrl: string, account: string): Promise<string | null> {
  const horizon = assertHttps443(horizonUrl);
  try {
    const res = await fetch(`${horizon}/accounts/${encodeURIComponent(account)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { home_domain?: string };
    const domain = json.home_domain?.trim() ?? "";
    return domain.length > 0 ? domain : null;
  } catch {
    return null;
  }
}

export async function findIncomingPayment(opts: {
  horizonUrl: string;
  accountId: string;
  chainMemo: string;
  amount: string;
}): Promise<IncomingPayment | null> {
  const horizon = assertHttps443(opts.horizonUrl);
  const list = await fetch(
    `${horizon}/accounts/${encodeURIComponent(opts.accountId)}/transactions?order=desc&limit=50`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  if (!list.ok) return null;
  const body = (await list.json()) as {
    _embedded?: {
      records?: Array<{
        hash?: string;
        memo?: string;
        memo_type?: string;
        successful?: boolean;
        ledger?: number;
        source_account?: string;
      }>;
    };
  };
  const records = body._embedded?.records ?? [];
  for (const tx of records) {
    if (tx.successful === false) continue;
    if ((tx.memo_type ?? "").toLowerCase() !== "text") continue;
    if ((tx.memo ?? "") !== opts.chainMemo) continue;
    if (!tx.hash) continue;
    const payments = await fetch(`${horizon}/transactions/${encodeURIComponent(tx.hash)}/payments?limit=10`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!payments.ok) continue;
    const payBody = (await payments.json()) as {
      _embedded?: {
        records?: Array<{
          type?: string;
          to?: string;
          account?: string;
          from?: string;
          funder?: string;
          amount?: string;
          starting_balance?: string;
          asset_type?: string;
        }>;
      };
    };
    for (const op of payBody._embedded?.records ?? []) {
      if (op.type === "payment" && op.asset_type === "native" && op.to === opts.accountId) {
        if (op.amount && amountsEqual(op.amount, opts.amount)) {
          return {
            hash: tx.hash,
            from: op.from || tx.source_account || "",
            ledger: Number(tx.ledger ?? 0),
            amount: canonicalAmount(op.amount) ?? op.amount,
          };
        }
      }
      if (op.type === "create_account" && op.account === opts.accountId) {
        const starting = op.starting_balance ?? "";
        if (starting && amountsEqual(starting, opts.amount)) {
          return {
            hash: tx.hash,
            from: op.funder || tx.source_account || "",
            ledger: Number(tx.ledger ?? 0),
            amount: canonicalAmount(starting) ?? starting,
          };
        }
      }
    }
  }
  return null;
}
