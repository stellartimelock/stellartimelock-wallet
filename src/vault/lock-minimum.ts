// Hard floor for creating a lock. Send and receive do not use this.
//
// Permanent Elite wallets skip the floor. That list lives in one place:
// src/tiers/permanent-elite.ts (`isPermanentEliteAccount`). A lower test
// tier on the dev wallet does not remove the exemption — the key is still
// on the permanent list.
//
// Inheritance and Lock and earn do not have create screens yet. When they
// do, they lock XLM and must call `lockMinimumNotice` before signing.
// A non-XLM token vault is not this floor: 10 of some other token is not
// 10 XLM.

import { isPermanentEliteAccount } from "@/src/tiers/permanent-elite";
import {
  MAINNET_DEPLOYMENT,
  TESTNET_DEPLOYMENT,
} from "@/src/wallet/contract-config";

/** 10 XLM. One XLM is 10_000_000 stroops. */
export const LOCK_MINIMUM_XLM = 10;

export const LOCK_MINIMUM_STROOPS = 100_000_000n;

/** Shown under the amount and used to block the create button. */
export const LOCK_MINIMUM_MESSAGE = "Locks need at least 10 XLM";

/**
 * XLM lock creates this floor applies to. Inheritance and LockAndEarn are
 * reserved so a future screen uses the same check.
 */
export const XLM_LOCK_CREATE_KINDS = [
  "TimeLock",
  "Inheritance",
  "CoolingOff",
  "Vesting",
  "DeadManSwitch",
  "MultiSig",
  "HTLC",
  "LockAndEarn",
] as const;

export type XlmLockCreateKind = (typeof XLM_LOCK_CREATE_KINDS)[number];

const NATIVE_XLM_SACS = new Set([
  MAINNET_DEPLOYMENT.nativeXlmSac,
  TESTNET_DEPLOYMENT.nativeXlmSac,
]);

/** True when this contract address is the wrapped-native XLM token. */
export function isNativeXlmSac(address: string | null | undefined): boolean {
  const id = (address || "").trim();
  return id.length > 0 && NATIVE_XLM_SACS.has(id);
}

export function xlmLockCreateKindNeedsMinimum(kind: string): boolean {
  return (XLM_LOCK_CREATE_KINDS as readonly string[]).includes(kind);
}

/**
 * Stroops for an XLM amount. Strings keep 7 decimal places exactly.
 * A number uses the same rounding as the Soroban submit path.
 * Returns null when the text is not a positive-looking amount yet.
 */
export function parseXlmToStroops(
  input: string | number | null | undefined,
): bigint | null {
  if (input == null) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return BigInt(Math.round(input * 10_000_000));
  }
  const raw = input.trim();
  if (!/^\d+(\.\d*)?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  let digits = frac;
  let carry = 0n;
  if (digits.length > 7) {
    const roundDigit = digits.charCodeAt(7) - 48;
    digits = digits.slice(0, 7);
    if (roundDigit >= 5) carry = 1n;
  }
  const padded = digits.padEnd(7, "0");
  return BigInt(whole) * 10_000_000n + BigInt(padded || "0") + carry;
}

/**
 * Message when a new XLM lock is under 10 XLM. Null when the amount is
 * empty, zero, exactly 10 or more, the asset is not XLM, or the wallet
 * is permanent Elite.
 */
export function lockMinimumNotice(
  amount: string | number | null | undefined,
  ownerPublicKey: string | null | undefined,
  opts?: { assetIsXlm?: boolean },
): string | null {
  if (opts?.assetIsXlm === false) return null;
  if (isPermanentEliteAccount(ownerPublicKey)) return null;
  const stroops = parseXlmToStroops(amount);
  if (stroops == null || stroops <= 0n) return null;
  if (stroops < LOCK_MINIMUM_STROOPS) return LOCK_MINIMUM_MESSAGE;
  return null;
}

/**
 * Same rule for an amount that is already stroops (what the contract call
 * will submit). Zero stays a separate "enter an amount" error.
 */
export function lockMinimumBlockReason(
  amountStroops: bigint,
  ownerPublicKey: string | null | undefined,
): string | null {
  if (isPermanentEliteAccount(ownerPublicKey)) return null;
  if (amountStroops <= 0n) return null;
  if (amountStroops < LOCK_MINIMUM_STROOPS) return LOCK_MINIMUM_MESSAGE;
  return null;
}
