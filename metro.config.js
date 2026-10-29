// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];


// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

// ---------------------------------------------------------------------------
// Node-built-in shims for Hermes (Android/iOS).
//
// `@stellar/stellar-sdk` (and transitive deps such as `sodium-native`,
// `axios`, `eventsource`, `bignumber.js`, etc.) imports CommonJS-style Node
// built-ins like `crypto`, `stream`, `events`, `assert`, `url`, `buffer`,
// etc. Hermes ships none of those modules, so the released bundle crashes
// at module-init time. We redirect each built-in specifier to its userland
// browserify polyfill at the resolver level. Paired with the global
// `Buffer`/`process` bootstrap in `src/polyfills/global.ts` (loaded from
// `index.js` BEFORE expo-router), this lets the SDK boot on Hermes.
//
// IMPORTANT: extend, never replace, the default `resolver.extraNodeModules`
// to preserve any aliases injected by Expo's metro preset.
// ---------------------------------------------------------------------------
config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  assert: require.resolve('assert/'),
  buffer: require.resolve('buffer/'),
  crypto: require.resolve('crypto-browserify'),
  events: require.resolve('events/'),
  http: require.resolve('http-browserify'),
  https: require.resolve('https-browserify'),
  os: require.resolve('os-browserify/browser'),
  path: require.resolve('path-browserify'),
  process: require.resolve('process/browser'),
  punycode: require.resolve('punycode/'),
  querystring: require.resolve('querystring-es3'),
  stream: require.resolve('stream-browserify'),
  string_decoder: require.resolve('string_decoder/'),
  url: require.resolve('url/'),
  vm: require.resolve('vm-browserify'),
};

module.exports = config;
