// Process-local copy of the unlocked wallet seed for PICK_KEY.
// The native side keeps it in RAM only. It is never written to disk
// and never put in the Android Keystore. Lock clears it with the
// session cache. A later fingerprint puts it back.

import { NativeModules } from "react-native";

type NativeMemory = {
  publish?: (seed: string) => void;
  clear?: () => void;
};

export function publishUnlockSeed(seed: string | null): void {
  try {
    const mod = NativeModules.WalletSeedMemory as NativeMemory | undefined;
    if (!seed) {
      mod?.clear?.();
      return;
    }
    mod?.publish?.(seed);
  } catch {
    // Node tests and web have no native module. The JS cache still holds the seed.
  }
}
