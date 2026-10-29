#!/usr/bin/env bash
# Build + optimize the HTLC WASM. Does not upload or deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> cargo test -p htlc"
cargo test -p htlc

echo "==> cargo build --release (wasm32)"
cargo build -p htlc --release --target wasm32-unknown-unknown

WASM="$ROOT/target/wasm32-unknown-unknown/release/htlc.wasm"
if command -v stellar >/dev/null 2>&1; then
  echo "==> stellar contract optimize"
  stellar contract optimize --wasm "$WASM"
  OUT="$ROOT/target/wasm32-unknown-unknown/release/htlc.optimized.wasm"
  echo "==> sha256: $(sha256sum "$OUT" | awk '{print $1}')"
  echo "Optimized WASM: $OUT"
else
  echo "stellar CLI not found — skipping optimize. Raw WASM: $WASM"
fi
