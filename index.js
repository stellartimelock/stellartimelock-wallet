// XLM Vault — custom app entry.
//
// `package.json`'s `"main"` points here instead of directly at
// `expo-router/entry`. The reason is that we MUST install Node-shim
// globals (`Buffer`, `process`) BEFORE expo-router begins evaluating
// modules. expo-router lazily reaches into the file-routed screens, some
// of which transitively import `@stellar/stellar-sdk` (and therefore
// `crypto`, `stream`, `assert`, etc.). On the Hermes engine those Node
// built-ins don't exist until our polyfill bootstrap runs.
//
// DO NOT add any logic here. This file is a two-line entry trampoline by
// design — anything else risks pulling additional modules into the
// pre-router boot phase and re-introducing the boot-time crash.

import "./src/polyfills/global";
import "expo-router/entry";
