# Contract Reference — Stellar TimeLock

Extracted from `stellartimelock-core` (clone + deployment docs) and verified
against this wallet's `src/wallet/**/contract-config.ts` files.

**Source repo:** https://github.com/stellartimelock/stellartimelock-core  
**Primary contract package:** `contracts/xlm_vault/`

All values below are **public** network identifiers. No secrets.

---

## Verification vs wallet config

| Check | Result |
|-------|--------|
| `xlm_vault` testnet contract id | ✅ matches `src/wallet/contract-config.ts` |
| `xlm_vault` mainnet contract id | ✅ matches `src/wallet/contract-config.ts` |
| Native XLM SAC (testnet + mainnet) | ✅ matches `src/wallet/contract-config.ts` |
| `xlm_vault` WASM hash | ✅ matches mainnet provenance comment in `contract-config.ts` |
| `multi_asset_vault_v2` testnet + mainnet | ✅ matches `src/wallet/advanced-vaults/contract-config.ts` |
| `dual_approval_vault` WASM hash | ✅ matches `src/wallet/advanced-vaults/contract-config.ts` |
| `multi_asset_vault` (beta) mainnet | ✅ matches `src/wallet/multi-asset-beta/contract-config.ts` |

---

## Deployed contract registry

| Name | Network | Contract ID | Native XLM SAC | Status |
|------|---------|-------------|----------------|--------|
| `xlm_vault` | Testnet | `CBIXRLC5GQ6O5UUJFVRIWZD77P5LUVJG3XGGUVS4EWHAJ6LXQZNKH35Z` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | live |
| `xlm_vault` | Mainnet | `CCWDMIPD4ZTTIV5LR53PD325MS6VRGF3WJEJRKNCIKK3G7H6AXJ3UE4F` | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | live |
| `multi_asset_vault_v2` (Advanced Vaults) | Testnet | `CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV` | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | smoke-tested |
| `multi_asset_vault_v2` (Advanced Vaults) | Mainnet | `CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM` | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | live |
| `multi_asset_vault` (Beta) | Mainnet | `CBKOYL6BHVCHB4DJFVNHLGJKLCIFVRRRDVN2NRWX6TKRHQJQZQHPCACV` | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` | live |
| `dual_approval_vault` | Per-vault instances | Fresh instance per vault from uploaded WASM hash | n/a | live |

---

## WASM bytecode hashes

| Contract | WASM sha256 | Notes |
|----------|-------------|-------|
| `xlm_vault` | `eb2e8262657c60520b23c1a02e329257a8cca512329efa30c9c72db6fd799680` | Identical testnet + mainnet artifact |
| `dual_approval_vault` | `703fc35c4823b3becf7ae010e2951da1e4a259d5ec46dd2b85edc7b0151b71c5` | 22,486 bytes; per-vault deploy from this hash |
| `multi_asset_vault_v2` | (see local deploy docs if present) | Mainnet upload tx recorded below |

---

## `xlm_vault` — detail

### Testnet

| Field | Value |
|-------|-------|
| Name | `xlm_vault` |
| Network | Stellar Testnet |
| Contract ID | `CBIXRLC5GQ6O5UUJFVRIWZD77P5LUVJG3XGGUVS4EWHAJ6LXQZNKH35Z` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Network passphrase | `Test SDF Network ; September 2015` |
| RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Deployer (public) | `GAEPPLTQ4OIBG4J6DSI33FDYBB7YCKWOT36DNVLNOV65PIVSBAVSGXLS` |
| Deploy tx | https://stellar.expert/explorer/testnet/tx/ce3429bfde5e07b4bc0f9d9ce146554091f994125ebdf9c5ccc80ae9569f35ae |
| Init tx | https://stellar.expert/explorer/testnet/tx/44bc51e2680b3769d2541f765c151ff67308a11bc34965ed2ce5ddeff0886b75 |
| Explorer | https://stellar.expert/explorer/testnet/contract/CBIXRLC5GQ6O5UUJFVRIWZD77P5LUVJG3XGGUVS4EWHAJ6LXQZNKH35Z |
| Core doc | `stellartimelock-core/contracts/xlm_vault/DEPLOYMENT.md` |
| Wallet config | `src/wallet/contract-config.ts` → `TESTNET_DEPLOYMENT` |

### Mainnet

| Field | Value |
|-------|-------|
| Name | `xlm_vault` |
| Network | Stellar Mainnet (Public) |
| Contract ID | `CCWDMIPD4ZTTIV5LR53PD325MS6VRGF3WJEJRKNCIKK3G7H6AXJ3UE4F` |
| Native XLM SAC | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| WASM hash | `eb2e8262657c60520b23c1a02e329257a8cca512329efa30c9c72db6fd799680` |
| Network passphrase | `Public Global Stellar Network ; September 2015` |
| RPC (primary) | `https://rpc.ankr.com/stellar_soroban` |
| RPC fallbacks | nodies → nova-node → soroban-rpc.stellar.org → sorobanrpc.com → creit.tech |
| Horizon | `https://horizon.stellar.org` |
| Friendbot | none |
| Deployer (burner) | `GBP4L2GO6OELSA6DBGMFVAWI5Z57CRYBEVWNTABOZ2CTCT23T2ALS37Y` |
| Upload + deploy tx | https://stellar.expert/explorer/public/tx/3965de1399e61ac97100e9ed812b59a73f1c79c470b07559a252c10593243cb0 |
| Init tx | https://stellar.expert/explorer/public/tx/1cc41dc374738aa3103f931c79f396f5337220748e538696541cd07813986a06 |
| Explorer | https://stellar.expert/explorer/public/contract/CCWDMIPD4ZTTIV5LR53PD325MS6VRGF3WJEJRKNCIKK3G7H6AXJ3UE4F |
| Core doc | `stellartimelock-core/contracts/xlm_vault/MAINNET_ROLLOUT.md` + README mainnet id |
| Wallet config | `src/wallet/contract-config.ts` → `MAINNET_DEPLOYMENT` |

---

## `multi_asset_vault_v2` — Advanced Vaults

| Field | Testnet | Mainnet |
|-------|---------|---------|
| Contract ID | `CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV` | `CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM` |
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| Deploy date | 2026-07-20 (`deployer-mav-v2`) | 2026-07-20 (`mainnet-deployer`) |
| Wasm upload tx | — | `08861df343ac4c75ea4bad3a6b7c789661e6403029354bc732b65b28effa4d12` |
| Create tx | — | `781abfa997238276826fae212318df29f4d043a4a84aeb655da23fc31172e6ae` |
| Explorer | [testnet](https://stellar.expert/explorer/testnet/contract/CAHAQAN6KYAQCJ34W6CVZJGMWRXKCZFHM32F37E4EFEIIC4636TD74BV) | [mainnet](https://stellar.expert/explorer/public/contract/CAPXQVGAD2TZNEDKZZDX3YKUBHQ2UI2XDI5AND6Z35D2YY2NZ7AJV6LM) |
| Wallet config | `src/wallet/advanced-vaults/contract-config.ts` | same |

Kinds: Cooling-Off, Vesting, Dead Man's Switch, MultiSig (plus TimeLock).

---

## `dual_approval_vault`

| Field | Value |
|-------|-------|
| Name | `dual_approval_vault` |
| Deployment model | Per-vault instance from pre-uploaded WASM |
| WASM size | 22,486 bytes |
| WASM hash (`DUAL_APPROVAL_WASM_HASH`) | `703fc35c4823b3becf7ae010e2951da1e4a259d5ec46dd2b85edc7b0151b71c5` |
| Wallet config | `src/wallet/advanced-vaults/contract-config.ts` |

---

## `multi_asset_vault` (Beta)

| Field | Value |
|-------|-------|
| Name | `multi_asset_vault` |
| Network | Mainnet |
| Contract ID | `CBKOYL6BHVCHB4DJFVNHLGJKLCIFVRRRDVN2NRWX6TKRHQJQZQHPCACV` |
| Native XLM SAC | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| Gate | `EXPO_PUBLIC_MULTI_ASSET_BETA=1` |
| Wallet config | `src/wallet/multi-asset-beta/contract-config.ts` |
| Note | `MULTI_ASSET_TESTNET_CONTRACT_ID` is a deprecated alias of the same mainnet id |

---

## Network endpoints

### Testnet

| Role | URL / value |
|------|-------------|
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Friendbot | `https://friendbot.stellar.org` |
| Passphrase | `Test SDF Network ; September 2015` |

### Mainnet

| Role | URL / value |
|------|-------------|
| Soroban RPC (primary) | `https://rpc.ankr.com/stellar_soroban` |
| Soroban RPC fallbacks | `https://stellar-soroban-public.nodies.app`, `https://mainnet.stellar.nova-node.xyz`, `https://soroban-rpc.stellar.org`, `https://mainnet.sorobanrpc.com`, `https://soroban-rpc.creit.tech` |
| Horizon | `https://horizon.stellar.org` |
| Passphrase | `Public Global Stellar Network ; September 2015` |

---

## What core published vs wallet-only

From the cloned `stellartimelock-core` HEAD (`0424d1b`):

| Artifact | In public `stellartimelock-core`? |
|----------|-----------------------------------|
| `xlm_vault` source, tests, DEPLOYMENT / MAINNET_ROLLOUT docs | yes — `contracts/xlm_vault/` |
| Mainnet contract id in README | yes — `CCWDMIPD4ZTTIV5LR53PD325MS6VRGF3WJEJRKNCIKK3G7H6AXJ3UE4F` |
| `multi_asset_vault_v2` / `dual_approval_vault` / beta sources | not in public core (wallet / private app trees only) |

---

*Generated 2026-08-01 from Cline's stellartimelock-core extract + wallet config cross-check.*
