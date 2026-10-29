// Global Node-shim bootstrap for React Native (Hermes).
//
// This file MUST be the first thing imported by the app entry point. Any
// module that touches `Buffer`, `process`, `crypto`, `stream`, etc. at
// module-init time (notably `@stellar/stellar-sdk` and its transitive
// dependencies) will look up these globals on first evaluation. If we
// install them lazily (e.g. inside a function), it's already too late —
// the SDK has thrown by then.
//
// Pair this with `metro.config.js`'s `resolver.extraNodeModules` mapping,
// which wires the Node built-in module names (`crypto`, `stream`, `events`,
// `assert`, `url`, `os`, `https`, `http`, `path`, `process`, `vm`,
// `string_decoder`, `punycode`, `querystring`, `buffer`) to their userland
// polyfill packages. Together they let the released Android bundle boot
// `@stellar/stellar-sdk` on Hermes without "TypeError: undefined is not
// an object" at import time.

// `react-native-get-random-values` MUST be the very first import in the
// entire app. It installs a native-backed `globalThis.crypto.getRandomValues`
// (Android SecureRandom + iOS SecRandomCopyBytes) via a synchronous JSI
// call. Hermes ships with NO crypto global, and the Stellar SDK uses
// `crypto.getRandomValues` for:
//   - Ed25519 keypair generation
//   - Random sequence padding inside `TransactionBuilder`
//   - Nonces for Soroban auth entries (`Networks.STELLAR_RANDOM_NONCE`)
// If any of those run before this polyfill executes you get either a
// silent "undefined is not a function" crash or — worse — non-secure
// randomness from a userland fallback. Pulling it in at module-load
// order #0 closes that window completely.
//
// We use a bare side-effect import (no symbol bound) — the package's
// only job is to mutate `globalThis`.
import "react-native-get-random-values";

// `fast-text-encoding` MUST run before anything else here. It registers
// `globalThis.TextEncoder` / `TextDecoder` if absent — Hermes ships
// without them and `@stellar/stellar-sdk`'s strkey / base32 helpers call
// `new TextEncoder()` synchronously during the very first
// `simulateTransaction` decode (that's what was throwing the local
// "invalid checksum" XDR-parse failure we patched around in
// soroban-client.ts). Pulling this in once at boot eliminates the root
// cause; the in-flight sticky-skip + cache fallback in
// `soroban-client.ts` stays as defence-in-depth for any future Hermes
// regression.
import "fast-text-encoding";

import "react-native-url-polyfill/auto";


import { Buffer as NodeBuffer } from "buffer";
import nodeProcess from "process";

const g: { Buffer?: typeof NodeBuffer; process?: typeof nodeProcess } =
  globalThis as unknown as {
    Buffer?: typeof NodeBuffer;
    process?: typeof nodeProcess;
  };

if (!g.Buffer) {
  g.Buffer = NodeBuffer;
}

// `process` is referenced by stream/util/assert at module-init. Hermes does
// not provide it; install a minimal shim with `env`, `nextTick`, `browser`.
if (!g.process) {
  g.process = nodeProcess;
}

// Some libs probe `process.env.NODE_ENV` and `process.env.NODE_DEBUG` at
// init time. Ensure `env` always exists even if a previously-installed
// shim left it undefined.
if (g.process && !g.process.env) {
  // @ts-expect-error -- minimal shim for libs that read process.env
  g.process.env = {};
}

// ---------------------------------------------------------------------------
// BigInt sanity check — i64 / u64 / i128 / u128 / i256 / u256 XDR decoding
// in `@stellar/stellar-base` (`scValToBigInt`, `XdrLargeInt.toBigInt`,
// `ScInt`) hands off to native `BigInt(...)`, BigInt literals (e.g. `1n`),
// and bit-shift arithmetic (`<<`, `>>`, `|`) on BigInts. We rely on
// Hermes's built-in BigInt implementation here — NO polyfill needed:
//
//   - Hermes shipped native `BigInt` in v0.12.0, which corresponds to
//     React Native 0.71. This project is on React Native 0.81.5
//     (`package.json`), so the runtime is well past the floor.
//   - The Babel preset (`babel-preset-expo` via Metro) does NOT strip
//     bigint literals or transpile them down to e.g. JSBI; it leaves
//     them as native BigInts on Hermes targets. We don't ship a custom
//     `babel.config.js` that overrides this.
//
// Below is a defensive tripwire: if a future RN/Hermes regression
// somehow ships without BigInt, we throw a CLEAR error at boot time
// instead of letting `scValToBigInt` fail with an opaque "BigInt is
// not defined" the first time the user opens the vault detail page.
// The check is O(1) and runs once per cold start.
//
// We intentionally test:
//   1. `typeof BigInt === "function"`  (constructor exists)
//   2. `1n << 64n === 18446744073709551616n`  (literal + shift work end-to-end)
// because some incomplete polyfills install BigInt but break bitshifts,
// which is exactly the operation `XdrLargeInt.toBigInt` performs on u64/u128.
// ---------------------------------------------------------------------------
(function assertBigIntSupport(): void {
  if (typeof BigInt !== "function") {
    throw new Error(
      "[xlm-vault] FATAL: native BigInt is missing. The Stellar SDK " +
        "needs it to decode Soroban i64/u128 contract values. Expected " +
        "to be present on Hermes since RN 0.71 / Hermes 0.12 — this " +
        "build is on RN 0.81.5, so something has gone very wrong.",
    );
  }
  // 2^64 — confirms BigInt literals and the `<<` operator both work.
  // (Plain `BigInt(...)` + multiplication wouldn't be enough; we
  // specifically need the bitshift path that the SDK exercises.)
  const expected: bigint = BigInt("18446744073709551616");
  let shifted: bigint;
  try {
    shifted = (1n << 64n) as bigint;
  } catch (e) {
    throw new Error(
      "[xlm-vault] FATAL: BigInt literals (`1n`) or bit-shift (`<<`) " +
        "are broken on this runtime. Soroban i128/u128 XDR decode will " +
        "fail. Root cause: " +
        (e instanceof Error ? e.message : String(e)),
    );
  }
  if (shifted !== expected) {
    throw new Error(
      `[xlm-vault] FATAL: BigInt bit-shift returned an unexpected value ` +
        `(got ${shifted.toString()}, expected ${expected.toString()}). ` +
        `Soroban u128 decoding cannot be trusted.`,
    );
  }
})();

export {};
