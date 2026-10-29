// FOSS QR scanner bridge. Only the F-Droid flavor registers NativeModules.FossQrScanner
// (ZXing). The Play flavor keeps expo-camera's scanner, so hasFossQrScanner is false there.
import { NativeModules } from "react-native";

type FossQrScannerModule = { scan(prompt: string): Promise<string | null> };

function getModule(): FossQrScannerModule | undefined {
  const m = (NativeModules as Record<string, unknown>).FossQrScanner as FossQrScannerModule | undefined;
  return m && typeof m.scan === "function" ? m : undefined;
}

export const hasFossQrScanner: boolean = getModule() !== undefined;

/** Opens the ZXing scanner. Resolves the QR text, or null if cancelled / unavailable. */
export async function scanQrFoss(prompt = ""): Promise<string | null> {
  const m = getModule();
  if (!m) return null;
  const out = await m.scan(prompt);
  return typeof out === "string" && out.length > 0 ? out : null;
}
