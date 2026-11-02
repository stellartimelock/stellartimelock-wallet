// SEP-0007 transaction request URI.
//
// `web+stellar:tx` carries an unsigned transaction envelope. Scopuly
// would sign it with the key the user keeps in Scopuly. This builder
// only assembles the URI. It refuses a secret, and it does not attach
// `callback` or `origin_domain`. Those wait until a signed return can
// be checked and a key is published on stellartimelock.com.

import { isStellarPublicKey } from "@/src/wallet/strkey";

const SEED_RE = /S[A-Z2-7]{55}/;
const XDR_RE = /^[A-Za-z0-9+/=]+$/;

export interface Sep7TxInput {
  /** Unsigned transaction envelope, base64 XDR. */
  xdr: string;
  /** Scopuly account that should be the source. Public key only. */
  pubkey: string;
  msg?: string;
}

export function buildWebStellarTxUri(input: Sep7TxInput): string {
  const extra = input as Sep7TxInput & Record<string, unknown>;
  if (extra.callback || extra.origin_domain || extra.originDomain || extra.signature) {
    throw new Error(
      "callback and origin_domain are not attached. A signed return must be checked first.",
    );
  }
  const xdr = input.xdr.trim();
  const pubkey = input.pubkey.trim();
  if (!XDR_RE.test(xdr) || xdr.length < 16) {
    throw new Error("Transaction XDR is not a base64 envelope.");
  }
  if (!isStellarPublicKey(pubkey)) {
    throw new Error("Scopuly account must be a public key.");
  }
  const blob = `${xdr} ${pubkey} ${input.msg ?? ""}`;
  if (SEED_RE.test(blob)) {
    throw new Error("A secret key cannot be placed in a SEP-7 link.");
  }
  const params = new URLSearchParams();
  params.set("xdr", xdr);
  params.set("pubkey", pubkey);
  if (input.msg?.trim()) params.set("msg", input.msg.trim().slice(0, 300));
  const uri = `web+stellar:tx?${params.toString()}`;
  if (/[?&](callback|origin_domain|signature)=/i.test(uri)) {
    throw new Error("callback and origin_domain are not attached.");
  }
  return uri;
}
