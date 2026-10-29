import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VERSION_CODE } from "../constants/app-version.ts";
import {
  checkForUpdate,
  getUpdateStatus,
  resetUpdateCheckForTests,
} from "../src/updates/check.ts";
import {
  assertHttpsUrl,
  isNewerVersion,
  parseUpdateManifest,
} from "../src/updates/manifest.ts";
import { createSampleUserData } from "../src/demo/sample-data.ts";
import {
  DEMO_DATA_KEY,
  DEMO_FLAG_KEY,
  REAL_DATA_KEY,
  createDataGate,
  createMemoryStorage,
  type Storage,
} from "../src/demo/store.ts";
import {
  amountToStroops,
  completeDonation,
  parseDonationAmount,
  type DonationDraft,
} from "../src/donations/donate.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

function isStellarPublicKey(value: string): boolean {
  if (value.length !== 56 || value[0] !== "G") return false;
  let bits = 0;
  let accumulator = 0;
  const out: number[] = [];
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return false;
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 255);
    }
  }
  const bytes = Uint8Array.from(out.slice(0, 35));
  if (bytes[0] !== 6 << 3) return false;
  const versioned = bytes.subarray(0, 33);
  const checksum = bytes[33] | (bytes[34] << 8);
  return checksum === crc16(versioned);
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    versionCode: 200,
    versionName: "2.0.0",
    apkUrl: "https://example.com/stellartimelock/stellartimelock-update.apk",
    notes: "Sample notes",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("update manifest", () => {
  it("parses the documented shape", () => {
    const parsed = parseUpdateManifest(manifest());
    assert.equal(parsed.versionCode, 200);
    assert.equal(parsed.versionName, "2.0.0");
    assert.equal(parsed.notes, "Sample notes");
    assert.equal(parsed.apkUrl.startsWith("https://"), true);
  });

  it("treats a higher versionCode as newer and ignores an equal or older one", () => {
    assert.equal(isNewerVersion(parseUpdateManifest(manifest({ versionCode: 111 })), 110), true);
    assert.equal(isNewerVersion(parseUpdateManifest(manifest({ versionCode: 110 })), 110), false);
    assert.equal(isNewerVersion(parseUpdateManifest(manifest({ versionCode: 109 })), 110), false);
  });

  it("rejects a non-integer versionCode, a missing field, and a non-https apk", () => {
    assert.throws(() => parseUpdateManifest(manifest({ versionCode: 1.5 })));
    assert.throws(() => parseUpdateManifest(manifest({ notes: 4 })));
    assert.throws(() =>
      parseUpdateManifest(manifest({ apkUrl: "http://example.com/app.apk" })),
    );
    assert.throws(() => assertHttpsUrl("not a url", "apkUrl"));
  });
});

describe("checkForUpdate", () => {
  it("publishes an available update only when the manifest is newer", async () => {
    resetUpdateCheckForTests();
    const available = await checkForUpdate({
      force: true,
      currentVersionCode: VERSION_CODE,
      fetchImpl: async () =>
        jsonResponse(
          manifest({
            versionCode: VERSION_CODE + 1,
            versionName: "1.2.0",
            notes: "A newer build",
          }),
        ),
    });
    assert.equal(available.phase, "available");
    if (available.phase === "available") {
      assert.equal(available.manifest.versionName, "1.2.0");
    }

    resetUpdateCheckForTests();
    const current = await checkForUpdate({
      force: true,
      currentVersionCode: VERSION_CODE,
      fetchImpl: async () => jsonResponse(manifest({ versionCode: VERSION_CODE })),
    });
    assert.equal(current.phase, "current");
    assert.equal(getUpdateStatus().phase, "current");
  });

  it("records an error and does not report an update when the manifest cannot be read", async () => {
    resetUpdateCheckForTests();
    let called = false;
    const failed = await checkForUpdate({
      force: true,
      url: "http://example.com/manifest.json",
      fetchImpl: async () => {
        called = true;
        return jsonResponse(manifest());
      },
    });
    assert.equal(called, false);
    assert.equal(failed.phase, "error");
    assert.notEqual(getUpdateStatus().phase, "available");
  });
});

describe("demo mode store", () => {
  it("serves sample data and leaves the real payload byte-for-byte", async () => {
    const realRaw = JSON.stringify({
      wallet: {
        label: "Real wallet",
        publicKey: "GREAL",
        availableXlm: "3.00",
      },
      vaults: [{ id: "real-vault" }],
      activity: [],
      contacts: [],
    });
    const inner = createMemoryStorage({ [REAL_DATA_KEY]: realRaw });
    const reads: string[] = [];
    const writes: string[] = [];
    const storage: Storage = {
      async getItem(key) {
        reads.push(key);
        return inner.getItem(key);
      },
      async setItem(key, value) {
        writes.push(key);
        return inner.setItem(key, value);
      },
    };
    const gate = createDataGate(storage);

    await gate.setDemo(true);
    const visible = await gate.readVisible();
    assert.equal(visible.wallet?.label, "Harbor sample");
    assert.equal(visible.vaults.length, 3);
    assert.equal(visible.contacts.length, 3);

    await gate.writeVisible({ ...visible, vaults: [] });
    await gate.setDemo(false);

    assert.equal(inner.dump()[REAL_DATA_KEY], realRaw);
    assert.equal(reads.includes(REAL_DATA_KEY), false);
    assert.equal(writes.includes(REAL_DATA_KEY), false);
    assert.equal(writes.includes(DEMO_DATA_KEY), true);
    assert.equal(writes.includes(DEMO_FLAG_KEY), true);

    const restored = await gate.readVisible();
    assert.equal(restored.wallet?.label, "Real wallet");
    assert.equal(restored.vaults.length, 1);
  });

  it("keeps demo edits across toggles and still does not rewrite real bytes", async () => {
    const realRaw = "{\"keep\":\"exactly this\"}";
    const storage = createMemoryStorage({ [REAL_DATA_KEY]: realRaw });
    const gate = createDataGate(storage);

    await gate.setDemo(true);
    const visible = await gate.readVisible();
    await gate.writeVisible({ ...visible, activity: [] });
    await gate.setDemo(false);
    await gate.setDemo(true);
    const again = await gate.readVisible();

    assert.equal(again.activity.length, 0);
    assert.equal(again.wallet?.label, "Harbor sample");
    assert.equal(storage.dump()[REAL_DATA_KEY], realRaw);
    await assert.rejects(() => gate.setDemo(false).then(() => gate.readVisible()));
  });

  it("ships sample accounts as checksum-valid public keys and no seed material", () => {
    assert.equal(
      isStellarPublicKey(
        "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
      ),
      true,
    );
    const sample = createSampleUserData();
    const keys = [
      sample.wallet?.publicKey,
      ...sample.contacts.map((contact) => contact.publicKey),
    ];
    for (const key of keys) {
      assert.equal(isStellarPublicKey(key ?? ""), true);
    }
    const serialized = JSON.stringify(sample).toLowerCase();
    assert.equal(serialized.includes("seed"), false);
    assert.equal(serialized.includes("secret"), false);
  });
});

describe("donation", () => {
  it("rejects an empty or zero amount before calling the sender", async () => {
    let calls = 0;
    const send = async () => {
      calls += 1;
    };
    const empty = await completeDonation("  ", send);
    const zero = await completeDonation("0.0000000", send);
    assert.equal(empty.ok, false);
    assert.equal(zero.ok, false);
    assert.equal(calls, 0);
  });

  it("hands stroops to the sender and returns success only after it resolves", async () => {
    const seen: DonationDraft[] = [];
    const ok = await completeDonation("1.5", async (draft) => {
      seen.push(draft);
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.amountXlm, "1.5");
    assert.equal(seen[0]?.stroops, "15000000");
    assert.equal(amountToStroops("0.0000001"), "1");
    assert.equal(parseDonationAmount("20").ok, true);
  });

  it("does not succeed when the sender fails", async () => {
    const failed = await completeDonation("20", async () => {
      throw new Error("Payment was rejected.");
    });
    assert.deepEqual(failed, { ok: false, reason: "Payment was rejected." });
  });
});
