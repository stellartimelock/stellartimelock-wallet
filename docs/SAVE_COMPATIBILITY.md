# Save compatibility (1.6.4)

Play builds through 1.6.3 keep working. This build reads every format those versions wrote. It does not delete an older file to write a new one.

Removing Assistant, Bills, and the money section does not drop a backup that still contains them. The money and bills fields are ignored. The rest of the envelope is kept.

## File wrapper

| What | Where | Versions |
| --- | --- | --- |
| Encrypted backup | `*.stvault`, and from 1.6.1 also `OS/StellarTimeLock/<stem>.os` | wrapper `format: stellar-timelock-backup`, `v: 1` |
| Inner envelope | JSON inside the wrapper, after decrypt | `v` 1 through 8 |
| Cipher | `src/security/backup-crypto.ts` | format 1 is `iv.ct`; format 2 is `iv.ct.mac`; format 3 is `v3.salt.iv.ct.mac`. New files are format 3. Formats 1 and 2 still open. Files written by 1.0.0–1.6.3 are format 2 with PBKDF2-SHA256 (crypto-js 4.2.0's default, 10,000 rounds). 1.6.4–1.6.7 tried SHA-1 on that layout and the MAC failed. 1.6.8 tries SHA-256, then SHA-1. |

The `.os` copy is the same wrapper. Writing it does not delete the `.stvault`.

## On-device JSON (not the encrypted file)

| Store | Key | Older rows |
| --- | --- | --- |
| Address book | `xlm_vault_address_book_v1` | Missing `network` becomes `stellar`. Missing `updatedAt` uses `createdAt`. |
| Wallet book | `xlm_vault_wallet_book_v1` | Legacy `xlm_vault_wallet_public` and `xlm_vault_wallet_secret` are left in place. |
| Key Manager | `xlm_vault_key_manager_v1` and `stellartimelock/key-manager.json` | A plaintext list is still read, then encrypted with the wallet seed (format 3) after a backup of the plaintext checks out. An already encrypted list opens with that same seed. Missing `chain` becomes `stellar`. Missing `watchOnly` stays false. |
| Authenticator | `xlm_vault_totp_entries_v1` | Read as before. |
| Request or pay | tap-pay save `v: 1` | Read as before. |
| Settings | `xlm_vault_network`, `xlm_vault_currency` | Unchanged. |

Seeds are not in the envelope. They stay in the session. Inside a backup, Key Manager entries can still include a `secretSeed`. That field is preserved when the entry is read. The on-phone Key Manager file is encrypted with the same seed, so a new phone opens it with that seed.

## Replace rule

`planSaveReplace` copies the current file to `.bak` before a replace. A shorter payload does not replace the longer file. Sibling `.stvault` names are kept when a `.os` file is written.

## Fixtures

`tests/fixtures/saves/` covers envelope v1 (address, no network), v6 (contact, TOTP, bills stub), v7 (wallet meta), v8 (stellar keys with no chain, multi-chain watch-only, and a money document), the `.stvault` wrapper with a plaintext payload, a sealed `iv.ct` payload, and the address book, wallet book, key manager, and tap-pay JSON shapes. `tests/fixtures/backup-writers-1.0-1.6.7.json` plus the `writer-*.json` files are the ciphertext each backup writer produced. `tests/save-compat.test.ts` loads each save. `tests/restore-168.test.ts` decrypts each writer.
