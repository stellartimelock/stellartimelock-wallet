// Read every save shape this wallet has written, without throwing.
//
// Play Store builds through 1.6.3 encrypt a JSON envelope inside a
// `.stvault` file (`format: "stellar-timelock-backup"`, wrapper `v: 1`).
// The envelope itself is `v` 1–8. 1.6.1 also copies that same wrapper to
// `OS/StellarTimeLock/<stem>.os`. Money and bills were an optional
// envelope field from the assistant work onward. This module ignores
// that field. It does not delete it from the file the user still has.

export const FILE_FORMAT = "stellar-timelock-backup";
export const FILE_WRAPPER_VERSION = 1;
export const ENVELOPE_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type EnvelopeVersion = (typeof ENVELOPE_VERSIONS)[number];

export interface NormalizedAddress {
  id: string;
  label: string;
  publicKey: string;
  defaultMemo: string;
  kind: string;
  network: "stellar" | "solana";
  icon?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NormalizedTotp {
  id: string;
  name: string;
  issuer?: string;
  secret: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NormalizedKey {
  id: string;
  label: string;
  chain: string;
  watchOnly: boolean;
  secretSeed: string;
  publicAddress: string;
  seedPhrase?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NormalizedWallet {
  id: string;
  label: string;
  publicKey: string;
  kind: string;
  createdAt: number;
  updatedAt: number;
}

export interface NormalizedTapPay {
  v: 1;
  writtenAt: number;
  paymentCount: number;
  knownRecipients: string[];
}

export interface ReadSave {
  kind:
    | "envelope"
    | "backup-file"
    | "address-book"
    | "wallet-book"
    | "key-manager"
    | "tap-pay"
    | "unknown";
  envelopeVersion: EnvelopeVersion | null;
  /** True when the wrapper payload is ciphertext, not a JSON envelope. */
  sealed: boolean;
  addresses: NormalizedAddress[];
  totp: NormalizedTotp[];
  keys: NormalizedKey[];
  wallets: NormalizedWallet[];
  tapPay: NormalizedTapPay | null;
  /** Money / bills were present and were not imported. */
  moneyIgnored: boolean;
  billsStubCount: number;
  warnings: string[];
}

function emptyRead(kind: ReadSave["kind"]): ReadSave {
  return {
    kind,
    envelopeVersion: null,
    sealed: false,
    addresses: [],
    totp: [],
    keys: [],
    wallets: [],
    tapPay: null,
    moneyIgnored: false,
    billsStubCount: 0,
    warnings: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** True when `money` is a document or a non-empty bills stub list. Never throws. */
export function moneySectionPresent(money: unknown, bills: unknown): boolean {
  try {
    if (Array.isArray(bills) && bills.length > 0) return true;
    if (!isRecord(money)) return false;
    if (Array.isArray(money.bills) && money.bills.length > 0) return true;
    if (Array.isArray(money.paymentMethods) && money.paymentMethods.length > 0) return true;
    if (isRecord(money.helper) && money.helper.enabled === true) return true;
    if (typeof money.coinbaseCardContactId === "string" && money.coinbaseCardContactId.length > 0) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function readAddress(raw: unknown): NormalizedAddress | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const publicKey = str(raw.publicKey);
  if (!id || !publicKey) return null;
  const createdAt = num(raw.createdAt);
  const network = raw.network === "solana" ? "solana" : "stellar";
  return {
    id,
    label: str(raw.label),
    publicKey,
    defaultMemo: str(raw.defaultMemo),
    kind: str(raw.kind) || "private",
    network,
    icon: typeof raw.icon === "string" ? raw.icon : undefined,
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
  };
}

function readTotp(raw: unknown): NormalizedTotp | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const secret = str(raw.secret);
  if (!id || !secret) return null;
  const createdAt = num(raw.createdAt);
  return {
    id,
    name: str(raw.name),
    issuer: typeof raw.issuer === "string" ? raw.issuer : undefined,
    secret,
    isDefault: raw.isDefault === true,
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
  };
}

function readKey(raw: unknown): NormalizedKey | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const publicAddress = str(raw.publicAddress);
  if (!id || !publicAddress) return null;
  const createdAt = num(raw.createdAt);
  return {
    id,
    label: str(raw.label),
    chain: str(raw.chain) || "stellar",
    watchOnly: raw.watchOnly === true,
    secretSeed: str(raw.secretSeed),
    publicAddress,
    seedPhrase: typeof raw.seedPhrase === "string" ? raw.seedPhrase : undefined,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
  };
}

function readWallet(raw: unknown): NormalizedWallet | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const publicKey = str(raw.publicKey);
  if (!id || !publicKey) return null;
  const createdAt = num(raw.createdAt);
  return {
    id,
    label: str(raw.label),
    publicKey,
    kind: str(raw.kind) || "imported",
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
  };
}

function readEnvelope(obj: Record<string, unknown>, into: ReadSave): void {
  const version = obj.v;
  if (typeof version === "number" && (ENVELOPE_VERSIONS as readonly number[]).includes(version)) {
    into.envelopeVersion = version as EnvelopeVersion;
    into.kind = "envelope";
  } else {
    into.warnings.push("envelope version was not 1–8");
    into.kind = "envelope";
  }
  if (!Array.isArray(obj.addresses)) {
    into.warnings.push("addresses missing");
  } else {
    for (const row of obj.addresses) {
      const address = readAddress(row);
      if (address) into.addresses.push(address);
    }
  }
  if (Array.isArray(obj.totp)) {
    for (const row of obj.totp) {
      const entry = readTotp(row);
      if (entry) into.totp.push(entry);
    }
  }
  if (Array.isArray(obj.keyManager)) {
    for (const row of obj.keyManager) {
      const key = readKey(row);
      if (key) into.keys.push(key);
    }
  }
  if (Array.isArray(obj.walletMeta)) {
    for (const row of obj.walletMeta) {
      const wallet = readWallet(row);
      if (wallet) into.wallets.push(wallet);
    }
  }
  into.billsStubCount = Array.isArray(obj.bills) ? obj.bills.length : 0;
  into.moneyIgnored = moneySectionPresent(obj.money, obj.bills);
}

function readTapPay(obj: Record<string, unknown>, into: ReadSave): boolean {
  if (obj.v !== 1 || !Array.isArray(obj.payments)) return false;
  const known = Array.isArray(obj.knownRecipients)
    ? obj.knownRecipients.filter((item) => typeof item === "string")
    : [];
  into.kind = "tap-pay";
  into.tapPay = {
    v: 1,
    writtenAt: num(obj.writtenAt),
    paymentCount: obj.payments.length,
    knownRecipients: known as string[],
  };
  return true;
}

function looksLikeEnvelope(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.addresses) && ("device" in obj || "notes" in obj || "v" in obj);
}

/**
 * Parse a backup file, a decrypted envelope, or an on-device JSON blob.
 * Ciphertext payloads are reported as sealed and are not decoded here.
 */
export function readSaveDocument(raw: unknown): ReadSave {
  const into = emptyRead("unknown");
  try {
    let value = raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) {
        into.warnings.push("empty");
        return into;
      }
      try {
        value = JSON.parse(trimmed);
      } catch {
        into.warnings.push("not json");
        return into;
      }
    }
    if (Array.isArray(value)) {
      const addresses = value.map(readAddress).filter((row): row is NormalizedAddress => !!row);
      const keys = value.map(readKey).filter((row): row is NormalizedKey => !!row);
      if (addresses.length > 0 && addresses.length >= keys.length) {
        into.kind = "address-book";
        into.addresses = addresses;
        return into;
      }
      if (keys.length > 0) {
        into.kind = "key-manager";
        into.keys = keys;
        return into;
      }
      into.warnings.push("empty list");
      return into;
    }
    if (!isRecord(value)) {
      into.warnings.push("not an object");
      return into;
    }

    if (value.format === FILE_FORMAT && typeof value.payload === "string") {
      into.kind = "backup-file";
      const payload = value.payload;
      if (payload.includes(".") && !payload.trim().startsWith("{")) {
        into.sealed = true;
        return into;
      }
      try {
        const inner = JSON.parse(payload) as unknown;
        const nested = readSaveDocument(inner);
        nested.kind = "backup-file";
        nested.sealed = false;
        return nested;
      } catch {
        into.sealed = true;
        into.warnings.push("payload was not an envelope");
        return into;
      }
    }

    if (looksLikeEnvelope(value)) {
      readEnvelope(value, into);
      return into;
    }
    if (Array.isArray(value.entries) && ("activeId" in value || value.entries.length === 0)) {
      into.kind = "wallet-book";
      for (const row of value.entries) {
        const wallet = readWallet(row);
        if (wallet) into.wallets.push(wallet);
      }
      return into;
    }
    if (readTapPay(value, into)) return into;
    into.warnings.push("unrecognised");
    return into;
  } catch (error) {
    into.warnings.push(error instanceof Error ? error.message : "read failed");
    return into;
  }
}

/**
 * Decide how to replace a save file. The live file is copied aside
 * before a replace. A shorter payload does not replace it.
 * Writing a `.os` copy never names the `.stvault` as something to delete.
 */
export function planSaveReplace(opts: {
  targetExists: boolean;
  previous: string | null;
  next: string;
  siblingNames?: string[];
}): { backup: boolean; replace: boolean; keepSiblings: string[] } {
  const siblings = (opts.siblingNames ?? []).filter((name) => name.endsWith(".stvault"));
  if (!opts.targetExists || opts.previous == null) {
    return { backup: false, replace: true, keepSiblings: siblings };
  }
  if (opts.next.length < opts.previous.length) {
    return { backup: true, replace: false, keepSiblings: siblings };
  }
  return { backup: true, replace: true, keepSiblings: siblings };
}
