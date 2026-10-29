// Browse-without-seed mode.
//
// Lets a user explore the wallet UI without importing/creating a
// Stellar secret seed. Persisted in AsyncStorage so cold starts that
// land on index.tsx still route into the main app instead of bouncing
// back to wallet-setup. Cleared automatically once a real wallet is
// connected (see session.tsx).

import { storage } from "@/src/utils/storage";

const BROWSE_MODE_KEY = "xlm_vault_browse_mode_v1";

export async function enableBrowseMode(): Promise<void> {
  await storage.setItem(BROWSE_MODE_KEY, "1");
}

export async function clearBrowseMode(): Promise<void> {
  await storage.removeItem(BROWSE_MODE_KEY);
}

export async function isBrowseMode(): Promise<boolean> {
  const v = await storage.getItem<string>(BROWSE_MODE_KEY, "");
  return v === "1";
}
