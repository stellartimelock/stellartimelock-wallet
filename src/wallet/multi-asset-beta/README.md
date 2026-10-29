# multi-asset-beta (frontend module)

Self-contained UI + RPC client for the **Multi-Asset Vault Mainnet BETA**.

> This entire folder is experimental and can be deleted without touching
> the production XLM vault code path.

## Files

| File | Purpose |
|---|---|
| `index.ts` | Public API + `isMultiAssetBetaEnabled()` feature-flag helper |
| `contract-config.ts` | Contract id + deployed-status detection |
| `MultiAssetBetaToggle.tsx` | The opt-in switch (renders `null` without env flag) |
| `TokenPicker.tsx` | Dropdown + paste-address input for the token contract |
| `client.ts` | Thin Soroban RPC client (`createBetaVault`, `listBetaOwned`) |

## Feature flag

Set `EXPO_PUBLIC_MULTI_ASSET_BETA=1` in `.env` and the toggle appears on
the Create Vault screen while the active wallet is on Mainnet. Testnet
callers get a clear "beta is Mainnet-only" error from `client.ts` — no
UI is displayed in that case.

## Removal

```bash
rm -rf /app/frontend/src/wallet/multi-asset-beta/
```

Then revert the block marked `/* --- MULTI-ASSET BETA (removable) --- */`
in `/app/frontend/app/create-vault.tsx` and unset the env flag. See the
contract folder's README for the full four-step removal contract.
