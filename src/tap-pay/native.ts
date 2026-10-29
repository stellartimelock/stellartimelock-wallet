// Android bridge for NFC host-card emulation, reader mode, and the
// signature-protected checkout intents. Missing on iOS and web: those
// builds keep the QR code and the deep link.

import { NativeModules, Platform } from "react-native";

export interface NfcStatus {
  available: boolean;
  enabled: boolean;
}

export interface HeldCheckout {
  action: "REQUEST_PAY" | "PAY";
  requestId: string;
  amount: string | null;
  memo: string | null;
  destination: string | null;
  uri: string | null;
  label: string | null;
}

export interface CheckoutResult {
  requestId: string;
  ok: boolean;
  hash?: string;
  amount?: string;
  destination?: string;
  payer?: string;
  error?: string;
}

interface TapPayNative {
  nfcStatus(): Promise<NfcStatus>;
  openNfcSettings(): Promise<boolean>;
  publishRequest(uri: string): Promise<boolean>;
  clearRequest(): Promise<boolean>;
  startReader(): Promise<string>;
  stopReader(): Promise<boolean>;
  currentCheckout(): Promise<HeldCheckout | null>;
  finishCheckout(result: CheckoutResult): Promise<boolean>;
}

function native(): TapPayNative | null {
  if (Platform.OS !== "android") return null;
  const mod = NativeModules?.TapPay as TapPayNative | undefined;
  if (!mod || typeof mod.nfcStatus !== "function") return null;
  return mod;
}

export function tapPayBridgeAvailable(): boolean {
  return native() !== null;
}

export async function readNfcStatus(): Promise<NfcStatus> {
  const mod = native();
  if (!mod) return { available: false, enabled: false };
  try {
    return await mod.nfcStatus();
  } catch {
    return { available: false, enabled: false };
  }
}

export async function openNfcSettings(): Promise<void> {
  const mod = native();
  if (!mod || typeof mod.openNfcSettings !== "function") return;
  try {
    await mod.openNfcSettings();
  } catch {
    /* The settings screen is optional. */
  }
}

export async function publishPaymentRequest(uri: string): Promise<void> {
  const mod = native();
  if (!mod) return;
  await mod.publishRequest(uri);
}

export async function clearPaymentRequest(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.clearRequest();
  } catch {
    /* The screen is going away. A leftover payload expires on its own. */
  }
}

export async function readPaymentRequest(): Promise<string | null> {
  const mod = native();
  if (!mod) return null;
  try {
    const uri = await mod.startReader();
    return uri || null;
  } catch {
    return null;
  }
}

export async function stopReadingPayment(): Promise<void> {
  const mod = native();
  if (!mod) return;
  try {
    await mod.stopReader();
  } catch {
    /* Reader already stopped. */
  }
}

export async function currentCheckout(): Promise<HeldCheckout | null> {
  const mod = native();
  if (!mod) return null;
  try {
    return await mod.currentCheckout();
  } catch {
    return null;
  }
}

export async function finishCheckout(result: CheckoutResult): Promise<void> {
  const mod = native();
  if (!mod || !result.requestId) return;
  try {
    await mod.finishCheckout(result);
  } catch {
    /* The calling app already went away. */
  }
}
