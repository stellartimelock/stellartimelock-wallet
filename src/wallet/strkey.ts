// Stellar StrKey encoder.
// Produces real `G...` (public) and `S...` (secret) addresses that any
// Stellar wallet (Lobstr, Freighter, Horizon) will accept.
//
// Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md
// Layout: [version_byte | payload (32 bytes) | crc16_xmodem (2 bytes, LE)] -> base32(no padding)

const VERSION_BYTE = {
  ed25519PublicKey: 6 << 3, // 48 -> 'G'
  ed25519SecretSeed: 18 << 3, // 144 -> 'S'
};

const RFC4648_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function crc16Xmodem(bytes: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += RFC4648_BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += RFC4648_BASE32[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const v = RFC4648_BASE32.indexOf(ch);
    if (v < 0) throw new Error("invalid base32 char");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out.slice(0, idx);
}

function encode(versionByte: number, payload: Uint8Array): string {
  const data = new Uint8Array(1 + payload.length);
  data[0] = versionByte;
  data.set(payload, 1);
  const crc = crc16Xmodem(data);
  const full = new Uint8Array(data.length + 2);
  full.set(data, 0);
  full[full.length - 2] = crc & 0xff;
  full[full.length - 1] = (crc >>> 8) & 0xff;
  return base32Encode(full);
}

export function encodeEd25519PublicKey(pubkey: Uint8Array): string {
  if (pubkey.length !== 32) throw new Error("public key must be 32 bytes");
  return encode(VERSION_BYTE.ed25519PublicKey, pubkey);
}

export function encodeEd25519SecretSeed(seed: Uint8Array): string {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  return encode(VERSION_BYTE.ed25519SecretSeed, seed);
}

export function decodeStrKey(s: string): { version: number; payload: Uint8Array } {
  const raw = base32Decode(s);
  if (raw.length !== 35) throw new Error("invalid strkey length");
  const version = raw[0];
  const payload = raw.slice(1, 33);
  const expectedCrc = raw[33] | (raw[34] << 8);
  const actualCrc = crc16Xmodem(raw.slice(0, 33));
  if (expectedCrc !== actualCrc) throw new Error("bad checksum");
  return { version, payload };
}

export function isStellarPublicKey(s: string): boolean {
  if (!s || s.length !== 56 || !s.startsWith("G")) return false;
  try {
    const { version } = decodeStrKey(s);
    return version === VERSION_BYTE.ed25519PublicKey;
  } catch {
    return false;
  }
}
