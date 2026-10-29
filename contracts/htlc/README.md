# HTLC — Hash Time-Locked Contract (XLM)

Standalone multi-vault Soroban contract for the Stellar TimeLock wallet.
Native XLM only. One deployed instance manages many independent HTLCs.

**Not** an extension of `mav_v2` / `multi_asset_vault_v2`.

## Layout

```
contracts/
  Cargo.toml          # workspace
  .cargo/config.toml
  htlc/
    Cargo.toml
    src/
      lib.rs          # create / claim / refund / getters
      storage.rs      # keys, TTL bumps, indexes
      test.rs         # unit tests (soroban testutils)
```

## Entrypoints

| Function | Auth | Description |
|----------|------|-------------|
| `initialize(token)` | none (once) | Bind wrapped-native XLM SAC |
| `create(sender, recipient, hash, deadline, amount) → u64` | sender | Lock XLM; returns `vault_id`. New locks need at least 10 XLM unless the sender is a permanent Elite account (the same keys as the app). Claim and refund do not re-check that floor. |
| `claim(vault_id, preimage)` | recipient | Reveal preimage before deadline |
| `refund(vault_id)` | sender | Reclaim after deadline |
| `get_vault(vault_id) → HtlcVault` | — | Full vault state |
| `list_sender_vaults(sender) → Vec<u64>` | — | Sender's vault IDs |
| `list_recipient_vaults(recipient) → Vec<u64>` | — | Recipient's vault IDs |
| `get_token() → Address` | — | Configured SAC |

### Events

| Name | Topics | Data |
|------|--------|------|
| `HtlcCreated` | `("HtlcCreated", vault_id)` | `(sender, recipient, hash, deadline, amount)` |
| `HtlcClaimed` | `("HtlcClaimed", vault_id)` | `preimage` |
| `HtlcRefunded` | `("HtlcRefunded", vault_id)` | `()` |

### Mainnet SAC

```
CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA
```

## Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI (install from https://developers.stellar.org/docs/tools/cli)
stellar --version
```

## Build

From the workspace root (`contracts/`):

```bash
cd contracts

# Unit tests (native host — do NOT pass --target wasm32 here)
cargo test -p htlc

# Release WASM
cargo build -p htlc --release --target wasm32-unknown-unknown

# Or: ./htlc/build.sh  (test + build + optional stellar optimize)

# Optimize (recommended before upload)
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/htlc.wasm
# → target/wasm32-unknown-unknown/release/htlc.optimized.wasm
```

If `cargo test` fails on `CryptoRng` / `ed25519-dalek`, re-pin:

```bash
cargo update -p ed25519-dalek --precise 2.2.0
```

WASM hash after optimize:

```bash
sha256sum target/wasm32-unknown-unknown/release/htlc.optimized.wasm
```

## Deploy (mainnet)

```bash
# 1) Upload WASM
stellar contract upload \
  --network mainnet \
  --source-account <DEPLOYER_SECRET_OR_ALIAS> \
  --wasm target/wasm32-unknown-unknown/release/htlc.optimized.wasm

# 2) Deploy instance from returned WASM hash
stellar contract deploy \
  --network mainnet \
  --source-account <DEPLOYER_SECRET_OR_ALIAS> \
  --wasm-hash <WASM_HASH>

# 3) Initialize with mainnet native XLM SAC
stellar contract invoke \
  --network mainnet \
  --source-account <DEPLOYER_SECRET_OR_ALIAS> \
  --id <CONTRACT_ID> \
  -- \
  initialize \
  --token CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA
```

Testnet SAC: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

After deploy, fill `contractId` / `wasmHash` in the wallet at
`src/wallet/advanced-vaults/contract-config.ts` (`getHtlcDeployment`).

## Design notes

- **XLM only** via SAC `transfer` into/out of the contract balance
- **Multi-vault**: monotonic `u64` ids; persistent per-vault records + sender/recipient indexes
- **No admin** after `initialize`: no upgrade, clawback, pause, or kill switch
- **TTL**: instance ~30d extend; persistent vault/index entries ~90d extend on touch
- **Deadline semantics**: claim requires `now < deadline`; refund requires `now > deadline`
