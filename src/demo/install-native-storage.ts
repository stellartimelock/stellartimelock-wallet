// Bind the demo gate to AsyncStorage on device.
// The sample key and the real-data key are separate from the wallet
// keystore (xlm_vault_*), so toggling demo mode does not rewrite seeds,
// vaults, or contacts.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { setDataGateStorage } from "./store";

let installed = false;

export function installDemoStorage(): void {
  if (installed) return;
  installed = true;
  setDataGateStorage({
    getItem(key) {
      return AsyncStorage.getItem(key);
    },
    setItem(key, value) {
      return AsyncStorage.setItem(key, value);
    },
  });
}
