// Smart address book.
//
// One list for the home carousel and the Send picker:
//   • in-app contacts (every older save shape)
//   • this phone's saved wallets, by name
//   • Key Manager public addresses (G… only), by label
//   • a vault's saved counterparty, when that address is a G…
// The same address from more than one source is shown once.
// Secrets are not read here. The phone's contact list is not read here.

import { listEntries } from "@/src/wallet/address-book";
import { loadBook } from "@/src/wallet/wallet-book";
import {
  hasKeyManagerSessionCache,
  listKeyPublicAddresses,
  peekKeyManagerPublicAddresses,
} from "@/src/security/key-manager-store";
import { listVaultCounterpartyAddresses } from "@/src/vault/multi-sig-store";
import {
  mergeSmartAddresses,
  type NamedPublicAddress,
  type SmartAddress,
  type SmartAddressSource,
  type SmartContactInput,
} from "@/src/send/smart-address-merge";

export { mergeSmartAddresses };
export type { NamedPublicAddress, SmartAddress, SmartAddressSource };

async function savedSources(): Promise<{
  contacts: SmartContactInput[];
  wallets: { id: string; label: string; publicKey: string }[];
  vaults: NamedPublicAddress[];
}> {
  const [contacts, book, vaults] = await Promise.all([
    listEntries("stellar"),
    loadBook(),
    listVaultCounterpartyAddresses(),
  ]);
  return { contacts, wallets: book.entries, vaults };
}

/**
 * Contacts, wallets, and vault counterparties right away. Key Manager
 * public addresses come from the session list when it is already open.
 * When it is not, `onKeys` runs after the yielding open and does not
 * hold up the first list.
 */
export async function loadSmartAddresses(
  onKeys?: (rows: SmartAddress[]) => void,
): Promise<SmartAddress[]> {
  const { contacts, wallets, vaults } = await savedSources();
  const cachedKeys = peekKeyManagerPublicAddresses();
  const first = mergeSmartAddresses({
    contacts,
    wallets,
    keys: cachedKeys,
    vaults,
  });
  if (!hasKeyManagerSessionCache()) {
    void listKeyPublicAddresses()
      .then((keys) => {
        onKeys?.(mergeSmartAddresses({ contacts, wallets, keys, vaults }));
      })
      .catch(() => undefined);
  }
  return first;
}
