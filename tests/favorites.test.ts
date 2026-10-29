import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  STELLAR_ADDRESS_MIME,
  assertPublicStellarAddress,
  favoriteLabel,
  linksFromSaved,
  loadRecipients,
  normalizeMemo,
  partitionRecipients,
  planAddressBookSync,
  type PhoneContactRow,
  type WalletContact,
} from "../src/contacts/favorites.ts";

const G_ADDRESS = `G${"A".repeat(55)}`;
const OTHER_G = `G${"B".repeat(55)}`;
const SECRET = `S${"A".repeat(55)}`;

function book(partial: Partial<WalletContact> & Pick<WalletContact, "id" | "publicKey">): WalletContact {
  return {
    label: partial.label ?? "Saved",
    defaultMemo: partial.defaultMemo ?? "",
    kind: partial.kind ?? "private",
    network: partial.network,
    id: partial.id,
    publicKey: partial.publicKey,
  };
}

function phone(partial: Partial<PhoneContactRow> & Pick<PhoneContactRow, "contactId">): PhoneContactRow {
  return {
    displayName: partial.displayName ?? "Ada",
    starred: partial.starred ?? true,
    address: partial.address ?? null,
    memo: partial.memo ?? null,
    contactId: partial.contactId,
  };
}

describe("phone favorites", () => {
  it("uses the Stellar TimeLock contacts mime type", () => {
    assert.equal(
      STELLAR_ADDRESS_MIME,
      "vnd.android.cursor.item/vnd.com.stellartimelock.address",
    );
  });

  it("accepts a public G address and an empty memo, and refuses secrets", () => {
    assert.equal(assertPublicStellarAddress(`  ${G_ADDRESS}  `), G_ADDRESS);
    assert.equal(normalizeMemo("  deposit  "), "deposit");
    assert.equal(normalizeMemo(""), "");
    assert.equal(normalizeMemo(null), "");
    assert.throws(() => assertPublicStellarAddress(SECRET), /public Stellar address/);
    assert.throws(
      () => assertPublicStellarAddress("legal winner thank year wave sausage worth useful legal winner thank yellow"),
      /public Stellar address/,
    );
    assert.throws(() => assertPublicStellarAddress("not-an-address"), /56-character/);
    assert.throws(() => normalizeMemo("m".repeat(29)), /28-byte/);
  });

  it("puts starred contacts first and does not repeat them in the address book", () => {
    const saved = book({ id: "ab1", publicKey: G_ADDRESS, label: "Kraken", defaultMemo: "99", kind: "exchange" });
    const other = book({ id: "ab2", publicKey: OTHER_G, label: "Mom" });
    const parts = partitionRecipients(
      [
        phone({ contactId: "7", displayName: "Ada Lovelace", address: G_ADDRESS, memo: "99" }),
        phone({ contactId: "8", displayName: "Bob", address: null }),
        phone({ contactId: "9", displayName: "Hidden", starred: false, address: OTHER_G }),
      ],
      [other, saved],
    );
    assert.deepEqual(
      parts.favorites.map((row) => row.displayName),
      ["Ada Lovelace", "Bob"],
    );
    assert.equal(parts.favorites[0].entry?.id, "ab1");
    assert.equal(parts.favorites[0].entry?.kind, "exchange");
    assert.equal(parts.favorites[1].address, null);
    assert.deepEqual(parts.addressBook.map((row) => row.id), ["ab2"]);
  });

  it("does not copy a secret or a non-address into the wallet address book", () => {
    const plans = planAddressBookSync(
      [
        phone({ contactId: "1", displayName: "Nope", address: SECRET }),
        phone({ contactId: "2", displayName: "Also nope", address: "hello world seed phrase here" }),
        phone({ contactId: "3", displayName: "  Grace Hopper  ", address: G_ADDRESS, memo: "  " }),
        phone({ contactId: "4", displayName: "Already", address: OTHER_G, memo: "keep" }),
      ],
      [book({ id: "have", publicKey: OTHER_G, defaultMemo: "keep", kind: "casino", label: "Casino" })],
    );
    assert.equal(plans.length, 1);
    assert.equal(plans[0].publicKey, G_ADDRESS);
    assert.equal(plans[0].defaultMemo, "");
    assert.equal(plans[0].kind, "private");
    assert.equal(plans[0].label, "Grace Hopper");
    assert.equal(plans[0].network, "stellar");
  });

  it("truncates a long contact name to the address-book label limit", () => {
    assert.equal(favoriteLabel("A".repeat(40)).length, 32);
    assert.equal(favoriteLabel("   "), "Favorite");
  });

  it("keeps working without contacts permission and does not query the phone", async () => {
    let queried = false;
    let upserts = 0;
    const savedBook = [book({ id: "local", publicKey: G_ADDRESS, label: "Local" })];
    const loaded = await loadRecipients("denied", {
      listStarred: async () => {
        queried = true;
        return [];
      },
      listBook: async () => savedBook,
      upsert: async () => {
        upserts += 1;
      },
    });
    assert.equal(queried, false);
    assert.equal(upserts, 0);
    assert.deepEqual(loaded.favorites, []);
    assert.equal(loaded.usedPhone, false);
    assert.equal(loaded.addressBook[0].id, "local");
  });

  it("syncs a starred address into the book and still sends if the phone read fails", async () => {
    const stored: WalletContact[] = [];
    const granted = await loadRecipients("granted", {
      listStarred: async () => [
        phone({ contactId: "3", displayName: "Grace", address: G_ADDRESS, memo: "memo" }),
      ],
      listBook: async () => stored.slice(),
      upsert: async (row) => {
        stored.push(book({ id: "new", publicKey: row.publicKey, label: row.label, defaultMemo: row.defaultMemo, kind: row.kind }));
      },
    });
    assert.equal(granted.usedPhone, true);
    assert.equal(stored.length, 1);
    assert.equal(granted.favorites[0].entry?.label, "Grace");
    assert.equal(granted.favorites[0].memo, "memo");

    const failed = await loadRecipients("granted", {
      listStarred: async () => {
        throw new Error("provider unavailable");
      },
      listBook: async () => stored.slice(),
      upsert: async () => {
        throw new Error("should not write");
      },
    });
    assert.equal(failed.usedPhone, false);
    assert.equal(failed.favorites.length, 0);
    assert.equal(failed.addressBook.length, 1);
  });

  it("links saved rows by address and memo and ignores secrets", () => {
    const links = linksFromSaved([
      phone({ contactId: "5", address: G_ADDRESS, memo: "aa" }),
      phone({ contactId: "6", address: SECRET, memo: "nope" }),
    ]);
    assert.deepEqual(links, { [`${G_ADDRESS}\naa`]: "5" });
  });

  it("does not ask for phone contacts and still keeps the in-app address book", () => {
    const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
    const appJson = readFileSync("app.json", "utf8");
    const book = readFileSync("src/wallet/address-book.ts", "utf8");
    const screen = readFileSync("app/contacts.tsx", "utf8");
    assert.equal(manifest.includes("READ_CONTACTS"), false);
    assert.equal(manifest.includes("WRITE_CONTACTS"), false);
    assert.equal(appJson.includes("READ_CONTACTS"), false);
    assert.equal(appJson.includes("WRITE_CONTACTS"), false);
    assert.equal(screen.includes("usePhoneFavorites"), false);
    assert.match(book, /listEntries/);
    assert.match(book, /upsertEntry/);
  });
});
