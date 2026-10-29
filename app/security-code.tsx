// Security code audit — in-app source & network interaction surface.
// Route: /security-code
//
// Section 1 embeds real excerpts from the wallet security modules.
// Section 2 lists RPC/Horizon endpoints, contract IDs, SACs, and the
// transaction / Soroban method surface the wallet submits on-chain.

import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  MAINNET_DEPLOYMENT,
  TESTNET_DEPLOYMENT,
} from "@/src/wallet/contract-config";
import {
  getAdvancedDeployment,
  getAdvancedNetworkName,
} from "@/src/wallet/advanced-vaults/contract-config";
import { MULTI_ASSET_MAINNET_CONTRACT_ID } from "@/src/wallet/multi-asset-beta/contract-config";
import { colors, tileShadow } from "@/src/theme";

const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

// Values mirrored from src/wallet/advanced-vaults/contract-config.ts
// (TESTNET / MAINNET consts are module-private; addresses are public).
const ADVANCED_TESTNET = {
  network: "testnet" as const,
  contractId: "CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV",
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  nativeXlmSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
};
const ADVANCED_MAINNET = {
  network: "mainnet" as const,
  contractId: "CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM",
  rpcUrl: "https://rpc.ankr.com/stellar_soroban",
  horizonUrl: "https://horizon.stellar.org",
  nativeXlmSac: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
};

interface CodeExcerpt {
  id: string;
  file: string;
  summary: string;
  defaultOpen: boolean;
  code: string;
}

const CODE_EXCERPTS: CodeExcerpt[] = [
  {
    id: "crypto",
    file: "src/security/crypto.ts",
    summary: "AES-256-CBC + HMAC-SHA256 encrypt/decrypt · PMK in SecureStore",
    defaultOpen: true,
    code: "// @CONTEXT: PMK is 64 random bytes (base64), split at read time into bytes[0..32) for the AES-256-CBC key and bytes[32..64) for the HMAC-SHA256 key — two independent 32-byte halves give key separation without an extra PBKDF2 pass on already-random material\nconst PMK_STORE_KEY = \"xlm_vault_productivity_master_key_v1\";\n\n// @CONTEXT: legacy device-random master key from the very first release; never read any more, but the constant is preserved so future migrations can find and delete the stale SecureStore slot if needed\n// eslint-disable-next-line @typescript-eslint/no-unused-vars\nconst LEGACY_DEVICE_MASTER_KEY_STORE_KEY = \"xlm_vault_notebook_master_key_v1\";\n\n// @CONTEXT: legacy wallet-derived key path, kept only as a decrypt fallback so pre-refactor ciphertext still round-trips through `decrypt()`; the salts/iterations exactly match the pre-refactor build\nconst WALLET_KDF_SALT = \"xlm_vault_notebook_v2_salt\";\nconst WALLET_KDF_MAC_SALT = \"xlm_vault_notebook_v2_mac_salt\";\nconst WALLET_KDF_ITERATIONS = 10000;\n\nconst AEAD_VERSION = 2 as const;\nexport type EncryptedFormatVersion = 1 | 2;\n\nlet _pmkAesKeyCache: CryptoJS.lib.WordArray | null = null;\nlet _pmkMacKeyCache: CryptoJS.lib.WordArray | null = null;\n\n// @CONTEXT: populated by `setActiveWalletForCrypto`; used only by `decrypt()` when the PMK-derived MAC verification fails, to re-attempt with wallet-derived keys — never mutates the primary PMK cache\nlet _legacyMigrationWallet: { publicKey: string; secretSeed: string } | null =\n  null;\nlet _legacyWalletAesKeyCache: CryptoJS.lib.WordArray | null = null;\nlet _legacyWalletMacKeyCache: CryptoJS.lib.WordArray | null = null;\n\n// @CONTEXT: registers (or clears) the wallet the crypto layer should fall back to when a legacy (pre-refactor) ciphertext fails PMK-based HMAC verification; unlike the pre-refactor implementation, this does NOT rotate the AES/MAC keys used for encryption or primary decryption — encryption always uses the device-scoped PMK, so all wallets on the same device see the same data. Called by SessionProvider whenever the active wallet changes so a subsequent legacy read can attempt migration with the correct wallet key\nexport function setActiveWalletForCrypto(\n  wallet: { publicKey: string; secretSeed: string } | null,\n): void {\n  const prevSeed = _legacyMigrationWallet?.secretSeed ?? null;\n  const nextSeed = wallet?.secretSeed ?? null;\n  if (prevSeed !== nextSeed) {\n    // Wipe the legacy caches so a follow-up decrypt derives against\n    // the newly-registered wallet's seed instead of a stale cache.\n    const prevAes = _legacyWalletAesKeyCache;\n    _legacyWalletAesKeyCache = null;\n    wipeWordArray(prevAes);\n    const prevMac = _legacyWalletMacKeyCache;\n    _legacyWalletMacKeyCache = null;\n    wipeWordArray(prevMac);\n  }\n  _legacyMigrationWallet = wallet;\n}\n\n/** 64 random bytes — first-launch generation of the PMK. */\nasync function generatePmkBase64(): Promise<string> {\n  const bytes = await Crypto.getRandomBytesAsync(64);\n  let binary = \"\";\n  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);\n  return (global as unknown as { btoa: (s: string) => string }).btoa(binary);\n}\n\n/**\n * Copy a mutable Uint8Array into a fresh CryptoJS WordArray so\n * PBKDF2 can consume it via the WordArray overload.\n */\nfunction wordsFromBytes(bytes: Uint8Array): CryptoJS.lib.WordArray {\n  const words: number[] = [];\n  for (let i = 0; i < bytes.length; i += 4) {\n    words.push(\n      ((bytes[i] ?? 0) << 24) |\n        ((bytes[i + 1] ?? 0) << 16) |\n        ((bytes[i + 2] ?? 0) << 8) |\n        (bytes[i + 3] ?? 0),\n    );\n  }\n  return CryptoJS.lib.WordArray.create(words, bytes.length);\n}\n\nasync function readOrCreatePmkBase64(): Promise<string> {\n  // Web fallback — SecureStore is not available. We fall back to a\n  // deterministic per-origin key derived from a stable browser secret.\n  // The web preview is intentionally NOT the trust boundary; users\n  // ship real vaults on native builds where SecureStore is enforced.\n  if (Platform.OS === \"web\") {\n    const w = globalThis as unknown as {\n      localStorage?: {\n        getItem(k: string): string | null;\n        setItem(k: string, v: string): void;\n      };\n    };\n    if (!w.localStorage) return \"web-fallback-pmk-plaintext-only-do-not-ship\";\n    const existing = w.localStorage.getItem(PMK_STORE_KEY);\n    if (existing) return existing;\n    const created = await generatePmkBase64();\n    w.localStorage.setItem(PMK_STORE_KEY, created);\n    return created;\n  }\n\n  try {\n    const existing = await SecureStore.getItemAsync(PMK_STORE_KEY);\n    // 64 bytes → base64 ~88 chars including padding; require >= 80\n    // to reject legacy 32-byte payloads that might live under this\n    // key from a previous experiment.\n    if (existing && existing.length >= 80) return existing;\n  } catch {\n    /* fall through to generation */\n  }\n  const created = await generatePmkBase64();\n  try {\n    await SecureStore.setItemAsync(PMK_STORE_KEY, created, {\n      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,\n    });\n  } catch {\n    /* proceed with in-memory PMK — encryption still works this session */\n  }\n  return created;\n}\n\n// …\n\n/**\n * Encrypt an arbitrary UTF-8 string. Always uses the device-scoped\n * PMK — no wallet involvement. Output layout (v2 AEAD):\n *   base64(iv) + \".\" + base64(ciphertext) + \".\" + base64(hmac)\n *\n * The HMAC-SHA256 is computed over the concatenation of `iv || ct`\n * (encrypt-then-MAC). `decrypt()` verifies the tag BEFORE decrypting.\n */\nexport async function encrypt(plaintext: string): Promise<string> {\n  const key = await getPmkAesKey();\n  const macKey = await getPmkMacKey();\n  const ivBytes = await Crypto.getRandomBytesAsync(16);\n  const ivWords: number[] = [];\n  for (let i = 0; i < ivBytes.length; i += 4) {\n    ivWords.push(\n      (ivBytes[i] << 24) |\n        (ivBytes[i + 1] << 16) |\n        (ivBytes[i + 2] << 8) |\n        ivBytes[i + 3],\n    );\n  }\n  const iv = CryptoJS.lib.WordArray.create(ivWords, 16);\n  const ct = CryptoJS.AES.encrypt(CryptoJS.enc.Utf8.parse(plaintext), key, {\n    iv,\n    mode: CryptoJS.mode.CBC,\n    padding: CryptoJS.pad.Pkcs7,\n  });\n  const macInput = iv.clone().concat(ct.ciphertext.clone());\n  const mac = CryptoJS.HmacSHA256(macInput, macKey);\n  return (\n    `${iv.toString(CryptoJS.enc.Base64)}.` +\n    `${ct.ciphertext.toString(CryptoJS.enc.Base64)}.` +\n    `${mac.toString(CryptoJS.enc.Base64)}`\n  );\n}\n\n// …\n\nfunction tryDecryptV2(\n  ivB64: string,\n  ctB64: string,\n  macB64: string,\n  aesKey: CryptoJS.lib.WordArray,\n  macKey: CryptoJS.lib.WordArray,\n): string | null {\n  const iv = CryptoJS.enc.Base64.parse(ivB64);\n  const ct = CryptoJS.enc.Base64.parse(ctB64);\n  const expected = CryptoJS.enc.Base64.parse(macB64);\n  const macInput = iv.clone().concat(ct.clone());\n  const computed = CryptoJS.HmacSHA256(macInput, macKey);\n  try {\n    if (!wordArraysEqualConstantTime(computed, expected)) return null;\n    const decrypted = CryptoJS.AES.decrypt(\n      CryptoJS.lib.CipherParams.create({ ciphertext: ct }),\n      aesKey,\n      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },\n    );\n    return decrypted.toString(CryptoJS.enc.Utf8);\n  } finally {\n    wipeWordArray(computed);\n  }\n}\n\nfunction tryDecryptV1(\n  ivB64: string,\n  ctB64: string,\n  aesKey: CryptoJS.lib.WordArray,\n): string {\n  const iv = CryptoJS.enc.Base64.parse(ivB64);\n  const ct = CryptoJS.enc.Base64.parse(ctB64);\n  const decrypted = CryptoJS.AES.decrypt(\n    CryptoJS.lib.CipherParams.create({ ciphertext: ct }),\n    aesKey,\n    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },\n  );\n  return decrypted.toString(CryptoJS.enc.Utf8);\n}\n\n// @CONTEXT: tries the device-scoped PMK first; if HMAC verification fails and a legacy migration wallet has been registered, falls back to the wallet-derived key pair as the migration path for pre-refactor ciphertext. Returns \"\" for empty/malformed input to match the previous shape so store-level callers can distinguish \"wrong key\" from \"never had data\"\nexport async function decrypt(payload: string): Promise<string> {\n  if (!payload || payload.indexOf(\".\") < 0) return \"\";\n  const parts = payload.split(\".\");\n\n  if (parts.length === 3) {\n    const [ivB64, ctB64, macB64] = parts;\n\n    // Try PMK first.\n    const pmkAes = await getPmkAesKey();\n    const pmkMac = await getPmkMacKey();\n    const pmkPlain = tryDecryptV2(ivB64, ctB64, macB64, pmkAes, pmkMac);\n    if (pmkPlain !== null) return pmkPlain;\n\n    // Fallback: legacy wallet-derived pair (if registered).\n    const walletAes = await getLegacyWalletAesKey();\n    const walletMac = await getLegacyWalletMacKey();\n    if (walletAes && walletMac) {\n      const walletPlain = tryDecryptV2(\n        ivB64,\n        ctB64,\n        macB64,\n        walletAes,\n        walletMac,\n      );\n      if (walletPlain !== null) return walletPlain;\n    }\n\n    // @CONTEXT: neither key matched — throw CRYPTO_NOT_READY so the caller (store's readAll) treats this as \"key not available yet\" and rethrows to preserve the ciphertext; without this, a follow-up write would overwrite the untouched ciphertext with a fresh (empty) blob, permanently destroying the user's data\n    throw new Error(CRYPTO_NOT_READY);\n  }\n\n  if (parts.length === 2) {\n    const [ivB64, ctB64] = parts;\n    // Try PMK. v1 has no MAC, so we can't verify — we just attempt\n    // the decrypt and trust the caller (JSON.parse etc.) to reject\n    // garbage.\n    const pmkAes = await getPmkAesKey();\n    const pmkPlain = tryDecryptV1(ivB64, ctB64, pmkAes);\n    if (pmkPlain && pmkPlain.length > 0) {\n      // Best-effort probe: is this valid UTF-8 JSON-ish? If it starts\n      // with `[` or `{` we accept it. Otherwise fall through to legacy\n      // wallet path.\n      const first = pmkPlain.charAt(0);\n      if (first === \"[\" || first === \"{\" || first === \"\\\"\") return pmkPlain;\n    }\n\n    const walletAes = await getLegacyWalletAesKey();\n    if (walletAes) {\n      const walletPlain = tryDecryptV1(ivB64, ctB64, walletAes);\n      if (walletPlain && walletPlain.length > 0) return walletPlain;\n    }\n    // Nothing decrypted to plausible plaintext — return \"\" so callers\n    // treat this as \"first launch / empty state\" rather than raising.\n    return \"\";\n  }\n\n  return \"\";\n}",
  },
  {
    id: "keystore",
    file: "src/security/session-keystore.ts",
    summary: "Seed get/set — memory only; biometric flag never reads the plain slot",
    defaultOpen: false,
    code: `export async function getWalletSeed(id: string): Promise<string | null> {
  publishLock();
  // Lock clears the cache. Signing and UI reads wait for a fingerprint grant.
  if (sessionLocked) return null;
  const cached = sessionCache.get(id);
  if (cached) {
    touch();
    return cached;
  }
  return null;
}

export async function setWalletSeed(
  id: string,
  seed: string,
): Promise<boolean> {
  const wasLocked = !isUnlocked();
  sessionCache.set(id, seed);
  sessionLocked = false;
  touch();
  publishLock();
  if (wasLocked) notifyLockChange();
  const wrapped = await persistDerivedSigningKey(id, seed);
  await retirePlainSeed(id, seed, wrapped);
  mirrorSeedToPicker();
  return true;
}`,
  },
  {
    id: "wipe",
    file: "src/security/secure-wipe.ts",
    summary: "Best-effort zeroing of mutable secret material",
    defaultOpen: false,
    code: "export function wipeBytes(buf: Uint8Array | Buffer | null | undefined): void {\r\n  if (!buf) return;\r\n  try {\r\n    // Uint8Array.prototype.fill exists in every RN JS engine we\r\n    // support (Hermes, V8, JSC). Buffer inherits from Uint8Array.\r\n    (buf as Uint8Array).fill(0);\r\n    // Deferred second-pass wipe — catches any engine-side scratch\r\n    // copy that briefly aliased our backing store between the\r\n    // synchronous fill above and the GC minor-cycle boundary.\r\n    if (typeof setTimeout === \"function\") {\r\n      setTimeout(() => {\r\n        try {\r\n          (buf as Uint8Array).fill(0);\r\n        } catch {\r\n          /* buffer may already have been detached by the caller */\r\n        }\r\n      }, DEFERRED_WIPE_MS);\r\n    }\r\n  } catch {\r\n    /* ignored — nothing better we can do */\r\n  }\r\n}\r\n\r\n/**\r\n * Zero the words backing a CryptoJS WordArray. WordArrays are the\r\n * primary carrier of secret material inside crypto-js (both the\r\n * PBKDF2 input and the derived key end up as WordArrays), so this\r\n * is our main hook for the KDF path.\r\n */\r\nexport function wipeWordArray(\r\n  wa: CryptoJS.lib.WordArray | null | undefined,\r\n): void {\r\n  if (!wa || !wa.words) return;\r\n  try {\r\n    for (let i = 0; i < wa.words.length; i++) {\r\n      wa.words[i] = 0;\r\n    }\r\n    wa.sigBytes = 0;\r\n  } catch {\r\n    /* ignored */\r\n  }\r\n}\r\n\r\n/**\r\n * Zero the sensitive private-key material held inside a Stellar SDK\r\n * Keypair. The SDK stores TWO copies of the secret internally:\r\n *\r\n *   • `_secretSeed`  — 32-byte ed25519 seed (Buffer/Uint8Array)\r\n *   • `_secretKey`   — 32-byte tweetnacl signing key (mutable)\r\n *\r\n * Both are mutable byte arrays. `.fill(0)` overwrites them in place\r\n * so a subsequent heap dump can't recover the seed from this object.\r\n *\r\n * ⚠️  Call this ONLY after every `sign()` you'll need from this\r\n *     Keypair is done — once wiped, further sign attempts will\r\n *     succeed with an all-zero key (i.e. produce an invalid\r\n *     signature), which the ed25519 verifier will reject.\r\n */\r\nexport function wipeKeypair(kp: Keypair | null | undefined): void {\r\n  if (!kp) return;\r\n  try {\r\n    // Cast through unknown to reach the SDK's private fields. This\r\n    // is intentionally coupled to @stellar/stellar-base's internal\r\n    // shape — if the SDK ever renames these we want the type system\r\n    // to complain and force a re-audit.\r\n    const inner = kp as unknown as {\r\n      _secretSeed?: Uint8Array | Buffer;\r\n      _secretKey?: Uint8Array | Buffer;\r\n    };\r\n    wipeBytes(inner._secretSeed);\r\n    wipeBytes(inner._secretKey);\r\n    // Best-effort: also drop the references so the GC can reclaim\r\n    // the (now-zeroed) ArrayBuffers sooner. The `undefined` cast\r\n    // is safe because the SDK guards `.rawSecretKey()` / `.sign()`\r\n    // with `_secretKey`-null checks.\r\n    try {\r\n      inner._secretSeed = undefined;\r\n      inner._secretKey = undefined;\r\n    } catch {\r\n      /* some engines forbid deleting non-configurable properties */\r\n    }\r\n  } catch {\r\n    /* ignored */\r\n  }\r\n}\r",
  },
  {
    id: "stellar",
    file: "src/wallet/stellar.ts",
    summary: "On-device seed generate / import (lives under src/wallet, not src/security)",
    defaultOpen: false,
    code: "export function generateKeypairSync(): StellarKeypair {\r\n  const seed = Crypto.getRandomBytes(32);\r\n  const pub = ed25519.getPublicKey(seed);\r\n  return {\r\n    publicKey: encodeEd25519PublicKey(pub),\r\n    secretSeed: encodeEd25519SecretSeed(seed),\r\n  };\r\n}\r\n\r\n/**\r\n * Recover a keypair from a `S...` secret seed.\r\n * Throws `InvalidSecretSeedError` for anything that isn't a valid 56-char S-StrKey.\r\n */\r\nexport function keypairFromSecretSeed(rawSecret: string): StellarKeypair {\r\n  const secret = (rawSecret ?? \"\").trim().toUpperCase();\r\n  if (secret.length !== 56 || !secret.startsWith(\"S\")) {\r\n    throw new InvalidSecretSeedError(\"Secret seed must be 56 characters and start with S.\");\r\n  }\r\n  let decoded;\r\n  try {\r\n    decoded = decodeStrKey(secret);\r\n  } catch (e) {\r\n    throw new InvalidSecretSeedError(\r\n      `Invalid secret seed: ${e instanceof Error ? e.message : String(e)}`,\r\n    );\r\n  }\r\n  if (decoded.version !== SECRET_SEED_VERSION) {\r\n    throw new InvalidSecretSeedError(\"Not a Stellar Ed25519 secret seed.\");\r\n  }\r\n  const pub = ed25519.getPublicKey(decoded.payload);\r\n  return {\r\n    publicKey: encodeEd25519PublicKey(pub),\r\n    secretSeed: secret,\r\n  };\r\n}\r\n\r\nexport async function createAndPersistKeypair(): Promise<StellarKeypair> {\r\n  const kp = generateKeypairSync();\r\n  await persistKeypair(kp);\r\n  return kp;\r\n}\r\n\r\nexport async function importAndPersistKeypair(rawSecret: string): Promise<StellarKeypair> {\r\n  const kp = keypairFromSecretSeed(rawSecret);\r\n  await persistKeypair(kp);\r\n  return kp;\r\n}\r\n\r\nasync function persistKeypair(kp: StellarKeypair): Promise<void> {\r\n  await storage.secureSet(SECRET_KEY, kp.secretSeed);\r\n  await storage.setItem(PUBLIC_KEY, kp.publicKey);\r\n}\r",
  },
  {
    id: "biometric",
    file: "src/security/biometric.ts",
    summary: "Biometric enroll, authenticate, HKDF key derivation",
    defaultOpen: false,
    code: "export async function authenticate(reason: string): Promise<boolean> {\r\n  if (Platform.OS === \"web\") {\r\n    // Web preview intentionally cannot enroll a real Secure Enclave.\r\n    // Return true so the Settings toggle can flip in the preview for\r\n    // reviewers; the underlying crypto will still fall back to the\r\n    // Phase-1 device key on web.\r\n    return true;\r\n  }\r\n  try {\r\n    const res = await LocalAuth.authenticateAsync({\r\n      promptMessage: reason,\r\n      cancelLabel: \"Cancel\",\r\n      disableDeviceFallback: true,\r\n      requireConfirmation: false,\r\n    });\r\n    return !!res.success;\r\n  } catch {\r\n    return false;\r\n  }\r\n}\r\n\n// …\n\nexport async function enroll(): Promise<EnrollmentResult> {\r\n  const availability = await getBiometricAvailability();\r\n  if (availability === \"no_hardware\") {\r\n    return { ok: false, reason: \"This device has no biometric hardware.\" };\r\n  }\r\n  if (availability === \"not_enrolled\") {\r\n    return {\r\n      ok: false,\r\n      reason: \"Add a fingerprint or Face ID in your device settings first.\",\r\n    };\r\n  }\r\n\r\n  const ok = await authenticate(\"Enable biometric unlock for Stellar TimeLock\");\r\n  if (!ok) return { ok: false, reason: \"Biometric prompt was cancelled or failed.\" };\r\n\r\n  // Only generate the secret if none exists (idempotent enrollment).\r\n  const existing = await readRootSecret();\r\n  if (!existing) {\r\n    const hex = await generateRandomHex(32);\r\n    try {\r\n      if (Platform.OS === \"web\") {\r\n        const w = globalThis as unknown as {\r\n          localStorage?: { setItem(k: string, v: string): void };\r\n        };\r\n        w.localStorage?.setItem(ROOT_SECRET_KEY, hex);\r\n      } else {\r\n        await SecureStore.setItemAsync(ROOT_SECRET_KEY, hex, {\r\n          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,\r\n          requireAuthentication: true,\r\n          authenticationPrompt: \"Unlock Stellar TimeLock\",\r\n        });\r\n      }\r\n    } catch (e) {\r\n      return {\r\n        ok: false,\r\n        reason: `Could not persist biometric key: ${e instanceof Error ? e.message : String(e)}`,\r\n      };\r\n    }\r\n  }\r\n\r\n  await setEnrolledFlag(true);\r\n  return { ok: true };\r\n}\r\n\n// …\n\nexport async function deriveKey(info: string): Promise<CryptoJS.lib.WordArray | null> {\r\n  const hex = await readRootSecret();\r\n  if (!hex) return null;\r\n  const ikm = CryptoJS.enc.Hex.parse(hex);\r\n  // Fixed application salt — not user-secret; HKDF's salt is public\r\n  // input by design (RFC 5869 §3.1).\r\n  const salt = CryptoJS.enc.Utf8.parse(\"xlm-vault:hkdf-salt:v1\");\r\n  return hkdfSha256(ikm, salt, info, 32);\r\n}\r",
  }
];

const TX_TYPES = [
  "invokeHostFunction — Soroban contract calls (standard + advanced vaults)",
  "payment — native XLM send (src/send/broadcast.ts)",
  "extendFootprintTtl — vault storage TTL keepalive",
  "restoreFootprint — wake archived Soroban entries",
  "createCustomContract — Multi-Sig vault instance deploy",
];

const SOROBAN_METHODS = [
  // Standard XLM vault (src/api/soroban-client.ts)
  "create_vault",
  "deposit",
  "extend_lock",
  "withdraw",
  "get_vault",
  "list_owned",
  // Advanced vaults (src/wallet/advanced-vaults/client.ts)
  "create_cooling_off_vault",
  "create_vesting_vault",
  "create_dead_man_switch_vault",
  "initiate_withdrawal",
  "cancel_withdrawal",
  "withdraw_vested",
  "ping",
  "backup_withdraw",
  "get_unlocked_amount",
  "initialize",
  "request_withdrawal",
  "approve_withdrawal",
  "claim",
  "get_withdrawal_request",
  // Multi-asset beta
  "create_vault (multi-asset)",
  "withdraw (multi-asset)",
  "list_owned (multi-asset)",
  "get_vault (multi-asset)",
  "balance (SAC token read)",
];

function CodeBlock({ excerpt }: { excerpt: CodeExcerpt }) {
  const [open, setOpen] = useState(excerpt.defaultOpen);
  return (
    <View style={styles.codeCard} testID={`security-code-${excerpt.id}`}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.75}
        style={styles.codeHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.codeFile}>{excerpt.file}</Text>
          <Text style={styles.codeSummary}>{excerpt.summary}</Text>
        </View>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
      {open ? (
        <ScrollView
          nestedScrollEnabled
          style={styles.codeScroll}
          contentContainerStyle={styles.codeScrollInner}
        >
          <ScrollView horizontal nestedScrollEnabled>
            <Text selectable style={styles.codeText}>
              {excerpt.code.replace(/\r\n/g, "\n")}
            </Text>
          </ScrollView>
        </ScrollView>
      ) : null}
    </View>
  );
}

function FactGroup({
  title,
  items,
}: {
  title: string;
  items: { label?: string; value: string }[];
}) {
  return (
    <View style={styles.factGroup}>
      <Text style={styles.factTitle}>{title}</Text>
      {items.map((it, i) => (
        <View key={`${title}-${i}`} style={styles.factRow}>
          {it.label ? <Text style={styles.factLabel}>{it.label}</Text> : null}
          <Text selectable style={styles.factValue}>
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function SecurityCodeScreen() {
  const router = useRouter();
  const advancedActive = getAdvancedDeployment();
  const advancedNetwork = getAdvancedNetworkName();

  return (
    <SafeAreaView edges={["top"]} style={styles.root} testID="security-code-screen">
      <View style={styles.headerBar}>
        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/settings")
          }
          style={styles.headerBack}
          hitSlop={12}
          accessibilityLabel="Back"
          testID="security-code-back"
        >
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Security code audit
        </Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          Real wallet source excerpts and the on-chain endpoints this app
          contacts. No placeholders.
        </Text>

        <View style={styles.sectionDivider}>
          <Text style={styles.sectionEyebrow}>SECTION 1</Text>
          <Text style={styles.sectionHeading}>Wallet Security Code</Text>
          <Text style={styles.sectionSub}>
            Expand a file to inspect the crypto boundary that protects seeds
            and local encrypted data.
          </Text>
        </View>

        {CODE_EXCERPTS.map((ex) => (
          <CodeBlock key={ex.id} excerpt={ex} />
        ))}

        <View style={[styles.sectionDivider, styles.sectionDividerSpaced]}>
          <Text style={styles.sectionEyebrow}>SECTION 2</Text>
          <Text style={styles.sectionHeading}>Blockchain Interactions</Text>
          <Text style={styles.sectionSub}>
            What this wallet sends to the Stellar network — endpoints,
            contracts, SACs, transaction types, and Soroban method names.
          </Text>
        </View>

        <FactGroup
          title="Soroban RPC endpoints"
          items={[
            { label: "Mainnet primary", value: MAINNET_DEPLOYMENT.rpcUrl },
            ...MAINNET_DEPLOYMENT.rpcFallbacks.map((u, i) => ({
              label: `Mainnet fallback ${i + 1}`,
              value: u,
            })),
            { label: "Testnet", value: TESTNET_DEPLOYMENT.rpcUrl },
            {
              label: `Advanced vaults (active: ${advancedNetwork})`,
              value: advancedActive.rpcUrl,
            },
          ]}
        />

        <FactGroup
          title="Horizon endpoints"
          items={[
            { label: "Mainnet", value: MAINNET_DEPLOYMENT.horizonUrl },
            { label: "Testnet", value: TESTNET_DEPLOYMENT.horizonUrl },
            {
              label: "Advanced vaults mainnet",
              value: ADVANCED_MAINNET.horizonUrl,
            },
            {
              label: "Advanced vaults testnet",
              value: ADVANCED_TESTNET.horizonUrl,
            },
          ]}
        />

        <FactGroup
          title="Contract addresses — standard vault"
          items={[
            {
              label: "Mainnet (xlm_vault)",
              value: MAINNET_DEPLOYMENT.contractId,
            },
            {
              label: "Testnet (xlm_vault)",
              value: TESTNET_DEPLOYMENT.contractId,
            },
          ]}
        />

        <FactGroup
          title="Contract addresses — advanced vaults"
          items={[
            {
              label: "Mainnet (multi_asset_vault_v2)",
              value: ADVANCED_MAINNET.contractId,
            },
            {
              label: "Testnet (multi_asset_vault_v2)",
              value: ADVANCED_TESTNET.contractId,
            },
            {
              label: "Multi-asset beta (mainnet)",
              value: MULTI_ASSET_MAINNET_CONTRACT_ID,
            },
          ]}
        />

        <FactGroup
          title="SAC addresses (native XLM)"
          items={[
            {
              label: "Mainnet native XLM SAC",
              value: MAINNET_DEPLOYMENT.nativeXlmSac,
            },
            {
              label: "Testnet native XLM SAC",
              value: TESTNET_DEPLOYMENT.nativeXlmSac,
            },
            {
              label: "Advanced mainnet SAC",
              value: ADVANCED_MAINNET.nativeXlmSac,
            },
            {
              label: "Advanced testnet SAC",
              value: ADVANCED_TESTNET.nativeXlmSac,
            },
          ]}
        />

        <FactGroup
          title="Transaction types submitted"
          items={TX_TYPES.map((value) => ({ value }))}
        />

        <FactGroup
          title="Soroban contract method names"
          items={SOROBAN_METHODS.map((value) => ({ value }))}
        />

        <Text style={styles.footerNote}>
          Source: src/wallet/contract-config.ts ·
          src/wallet/advanced-vaults/contract-config.ts ·
          src/wallet/multi-asset-beta/contract-config.ts ·
          src/api/soroban-client.ts · src/wallet/advanced-vaults/client.ts ·
          src/send/broadcast.ts
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  body: { padding: 16, paddingBottom: 48 },
  intro: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 20,
  },
  sectionDivider: {
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  sectionDividerSpaced: {
    marginTop: 28,
  },
  sectionEyebrow: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  sectionHeading: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  sectionSub: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  codeCard: {
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    marginBottom: 10,
    ...tileShadow(),
  },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  codeFile: {
    color: colors.cyan,
    fontSize: 12,
    fontFamily: MONO,
    fontWeight: "700",
  },
  codeSummary: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 3,
    lineHeight: 15,
  },
  codeScroll: {
    maxHeight: 320,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  codeScrollInner: {
    padding: 12,
  },
  codeText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: MONO,
  },
  factGroup: {
    backgroundColor: colors.surfaceFrost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    padding: 12,
    marginBottom: 10,
    ...tileShadow(),
  },
  factTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 10,
  },
  factRow: {
    marginBottom: 8,
  },
  factLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  factValue: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: MONO,
  },
  footerNote: {
    color: colors.textTertiary,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
    fontFamily: MONO,
  },
});
