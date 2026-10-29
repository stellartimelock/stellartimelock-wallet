import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  encryptV2,
  encryptV2CryptoJsDefault,
} from "../src/security/backup-crypto.ts";
import { mergeSmartAddresses } from "../src/send/smart-address-merge.ts";
import {
  openStoredAddressBook,
  parseAddressBookValue,
} from "../src/wallet/address-book-parse.ts";

const SEED = "SSECRETSEEDFORTESTS";
const OTHER = "SOTHERSEEDFORTESTSXXXX";
const IV = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

const OLD = "GAWEHPRGF6VWNIZUR5NO7JR7DGRPX5PGZMX6HFJJI5AX3OWQ4VRJTK5C";
const HARBOR = "GB6P6K3CFDBVJ2N6IYO526U33UTWRYJLSDYF2NJC54B3BGO46URROVJX";
const KEY_ONLY = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const VAULT_ONLY = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const SOL = "So11111111111111111111111111111111111111112";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(`tests/fixtures/address-book/${name}`, "utf8"),
  ) as unknown;
}

describe("1.6.9 smart address book", () => {
  it("reads an already-parsed array, a JSON string, aliases, and an envelope", () => {
    const array = parseAddressBookValue(loadFixture("single-encoded-array.json"));
    assert.equal(array.length, 1);
    assert.equal(array[0].label, "Old contact");
    assert.equal(array[0].publicKey, OLD);
    assert.equal(array[0].defaultMemo, "rent");
    assert.equal(array[0].network, "stellar");

    const asString = parseAddressBookValue(
      JSON.stringify(loadFixture("single-encoded-array.json")),
    );
    assert.equal(asString[0].id, "c_old");

    const alias = parseAddressBookValue(loadFixture("alias-row.json"));
    assert.equal(alias.length, 1);
    assert.equal(alias[0].label, "Alias row");
    assert.equal(alias[0].publicKey, KEY_ONLY);
    assert.equal(alias[0].defaultMemo, "deposit-9");
    assert.equal(alias[0].kind, "exchange");

    const envelope = parseAddressBookValue(loadFixture("envelope-addresses.json"));
    assert.equal(envelope[0].label, "Envelope friend");
    assert.equal(envelope[0].publicKey, VAULT_ONLY);
    assert.equal(envelope[0].kind, "private");
  });

  it("opens a seed-sealed book with SHA-256 and SHA-1, and does not invent rows", async () => {
    const plain = JSON.stringify([
      {
        id: "c_sealed",
        name: "Sealed friend",
        address: OLD,
        memo: "hi",
        createdAt: 1,
      },
    ]);
    const sha256 = encryptV2CryptoJsDefault(plain, SEED, IV);
    const opened = await openStoredAddressBook(sha256, SEED);
    assert.equal(opened[0].label, "Sealed friend");
    assert.equal(opened[0].publicKey, OLD);
    assert.equal(opened[0].defaultMemo, "hi");

    const sha1 = encryptV2(plain, SEED, IV);
    const openedSha1 = await openStoredAddressBook(sha1, SEED);
    assert.equal(openedSha1[0].id, "c_sealed");

    assert.deepEqual(await openStoredAddressBook(sha256, OTHER), []);
    assert.deepEqual(await openStoredAddressBook(sha256, null), []);
    assert.equal(sha256.split(".").length, 3);
  });

  it("lists wallets, saved keys, and vault addresses once, and keeps the contact", () => {
    const rows = mergeSmartAddresses({
      contacts: [
        {
          id: "c_harbor",
          label: "Harbor contact",
          publicKey: HARBOR.toLowerCase(),
          defaultMemo: "memo-1",
          kind: "exchange",
          createdAt: 2,
        },
        {
          id: "c_sol",
          label: "Sol destination",
          publicKey: SOL,
          defaultMemo: "",
          kind: "private",
          network: "solana",
          createdAt: 3,
        },
      ],
      wallets: [
        { id: "w_harbor", label: "Harbor sample", publicKey: HARBOR },
        { id: "w_only", label: "Spending", publicKey: `g${"b".repeat(55)}` },
      ],
      keys: [
        {
          id: "km_desk",
          label: "Desk key",
          publicAddress: HARBOR,
          chain: "stellar",
        },
        {
          id: "km_only",
          label: "Cold key",
          publicAddress: KEY_ONLY,
          chain: "stellar",
        },
        {
          id: "km_eth",
          label: "Ether",
          publicAddress: "0xabc",
          chain: "eth",
        },
      ],
      vaults: [
        { id: "vault_harbor", label: "Vault", publicKey: HARBOR },
        { id: "vault_only", label: "Vault", publicKey: VAULT_ONLY },
        { id: "vault_contract", label: "Vault", publicKey: `C${"A".repeat(55)}` },
      ],
    });

    const byId = new Map(rows.map((row) => [row.publicKey, row]));
    assert.equal(byId.size, 5);
    assert.equal(byId.get(HARBOR)?.source, "contact");
    assert.equal(byId.get(HARBOR)?.label, "Harbor contact");
    assert.equal(byId.get(HARBOR)?.defaultMemo, "memo-1");
    assert.equal(byId.get(`G${"B".repeat(55)}`)?.source, "wallet");
    assert.equal(byId.get(`G${"B".repeat(55)}`)?.label, "Spending");
    assert.equal(byId.get(KEY_ONLY)?.source, "key");
    assert.equal(byId.get(KEY_ONLY)?.label, "Cold key");
    assert.equal(byId.get(VAULT_ONLY)?.source, "vault");
    assert.equal(byId.get(SOL)?.source, "contact");
    assert.equal(byId.has(`C${"A".repeat(55)}`), false);

    const dumped = JSON.stringify(rows);
    assert.equal(dumped.includes("secretSeed"), false);
    assert.equal(dumped.includes("seedPhrase"), false);
    assert.equal(dumped.includes(SEED), false);
  });

  it("shows public addresses on Home and Send, and does not read the phone", () => {
    const book = readFileSync("src/send/smart-address-book.ts", "utf8");
    const home = readFileSync("app/(tabs)/wallet.tsx", "utf8");
    const picker = readFileSync("src/send/components/AddressBookPicker.tsx", "utf8");
    const keys = readFileSync("src/security/key-manager-store.ts", "utf8");
    const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    assert.equal(book.includes("expo-contacts"), false);
    assert.equal(book.includes("favorites"), false);
    assert.equal(home.includes("expo-contacts"), false);
    assert.match(home, /loadSmartAddresses/);
    assert.match(picker, /loadSmartAddresses/);
    assert.match(picker, /entry\.source !== "contact"/);
    assert.match(keys, /function toPublicAddresses/);
    assert.equal(keys.includes("secretSeed: entry.secretSeed"), false);
    assert.equal(manifest.includes("READ_CONTACTS"), false);
  });
});
