// Key Manager ↔ wallet-book sync helpers.
//
// Key Manager already holds secret seeds (included in encrypted .stvault
// backups). These helpers move signing wallets into the wallet switcher
// (or the reverse) without asking the user to re-type seeds, and without
// surfacing plaintext secrets in the UI.

import { Alert, Platform } from "react-native";

import {
  findKeyEntryByPublicAddress,
  listKeyEntries,
  upsertKeyEntry,
  type KeyManagerEntry,
} from "@/src/security/key-manager-store";
import { setWalletMnemonic } from "@/src/security/session-keystore";
import {
  getCurrentTier,
  hasTierAccess,
  hydrateTier,
} from "@/src/tiers/tier-config";
import {
  addImportedWallet,
  loadBook,
  type WalletMeta,
} from "@/src/wallet/wallet-book";
import { shortenAddress } from "@/src/wallet/stellar";

/** Plus+ gate for multi-wallet Key Manager import / sync prompts. */
export function canUseKeyManagerWalletSync(
  tier = getCurrentTier(),
): boolean {
  return hasTierAccess("plus", tier);
}

/**
 * Key Manager entries that are NOT already in the wallet switcher.
 * Optionally exclude public keys (e.g. the wallet just restored).
 */
export async function listImportableKeyManagerEntries(
  excludePublicKeys: string[] = [],
): Promise<KeyManagerEntry[]> {
  const exclude = new Set(
    excludePublicKeys.map((k) => (k || "").trim().toUpperCase()).filter(Boolean),
  );
  const [entries, book] = await Promise.all([listKeyEntries(), loadBook()]);
  const inBook = new Set(book.entries.map((e) => e.publicKey.toUpperCase()));
  return entries.filter((e) => {
    const pk = (e.publicAddress || "").trim().toUpperCase();
    if (!pk || !(e.secretSeed || "").trim()) return false;
    if (exclude.has(pk)) return false;
    if (inBook.has(pk)) return false;
    return true;
  });
}

/**
 * Import one Key Manager entry into the wallet book / switcher.
 * Does not make it active by default (keeps the current wallet selected).
 * Never returns or logs the secret seed.
 */
export async function importKeyManagerEntryAsWallet(
  entry: KeyManagerEntry,
  options?: { makeActive?: boolean },
): Promise<{ meta: WalletMeta; wasAlreadyImported: boolean }> {
  const makeActive = options?.makeActive === true;
  const { meta, wasAlreadyImported } = await addImportedWallet(
    entry.label,
    entry.secretSeed,
    makeActive,
  );
  if (entry.seedPhrase && !wasAlreadyImported) {
    await setWalletMnemonic(meta.id, entry.seedPhrase).catch(() => false);
  }
  return { meta, wasAlreadyImported };
}

export async function isWalletSavedInKeyManager(
  publicKey: string,
): Promise<boolean> {
  const found = await findKeyEntryByPublicAddress(publicKey);
  return !!found;
}

/**
 * Persist a connected wallet into Key Manager when missing.
 * Uses the wallet switcher label; does not overwrite an existing entry's seed.
 */
export async function saveConnectedWalletToKeyManager(input: {
  label: string;
  secretSeed: string;
  publicAddress: string;
  seedPhrase?: string;
}): Promise<{ entry: KeyManagerEntry; alreadyPresent: boolean }> {
  const existing = await findKeyEntryByPublicAddress(input.publicAddress);
  if (existing) {
    return { entry: existing, alreadyPresent: true };
  }
  const entry = await upsertKeyEntry({
    label: input.label.trim() || "Wallet",
    secretSeed: input.secretSeed,
    publicAddress: input.publicAddress,
    seedPhrase: input.seedPhrase,
  });
  return { entry, alreadyPresent: false };
}

/** True when this Key Manager pubkey is already a signing wallet. */
export async function isKeyManagerEntryInWalletBook(
  publicKey: string,
): Promise<boolean> {
  const pk = (publicKey || "").trim().toUpperCase();
  if (!pk) return false;
  const book = await loadBook();
  return book.entries.some((e) => e.publicKey.toUpperCase() === pk);
}

/**
 * Prompt to save a newly connected / imported wallet into Key Manager
 * when it is not already there. Free tier sees an upgrade notice.
 * Does not display the secret seed.
 */
export async function promptSaveWalletToKeyManager(input: {
  label: string;
  secretSeed: string;
  publicAddress: string;
  seedPhrase?: string;
}): Promise<"saved" | "skipped" | "already" | "upgrade" | "error"> {
  try {
    await hydrateTier().catch(() => undefined);
    const already = await isWalletSavedInKeyManager(input.publicAddress);
    if (already) return "already";

    const plus = canUseKeyManagerWalletSync(getCurrentTier());
    if (!plus) {
      await new Promise<void>((resolve) => {
        Alert.alert(
          "Save to Key Manager?",
          "Key Manager (Plus and up) can store this wallet for multi-wallet restore. Upgrade in Settings → Test Tier Selection.",
          [{ text: "OK", onPress: () => resolve() }],
        );
        // react-native-web's Alert.alert is a no-op, so the OK handler
        // never runs and "Enter Stellar TimeLock" would hang forever.
        if (Platform.OS === "web") resolve();
      });
      return "upgrade";
    }

    const shouldSave = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Save to Key Manager?",
        `Also save "${input.label || "this wallet"}" (${shortenAddress(input.publicAddress, 6, 4)}) to Key Manager? The seed will not be shown.`,
        [
          { text: "Skip", style: "cancel", onPress: () => resolve(false) },
          { text: "Save", onPress: () => resolve(true) },
        ],
      );
      if (Platform.OS === "web") resolve(false);
    });
    if (!shouldSave) return "skipped";

    await saveConnectedWalletToKeyManager(input);
    return "saved";
  } catch {
    return "error";
  }
}
