# Scopuly SEP-7 request proposal

This note is for Scopuly (info@scopuly.com). It lists the StellarTimeLock vault actions that need a signature, and the `web+stellar:tx` flow we would use. StellarTimeLock has not turned that flow on.

## Client

StellarTimeLock is a React Native / Expo app. This handoff is the Android app, package `com.stellartimelock`. There is no web wallet in this flow. The user keeps their secret key in the Scopuly Android app and approves there.

The in-app Scopuly page links only to:

- Google Play: https://play.google.com/store/apps/details?id=com.sdex.app
- X: https://x.com/scopuly

It does not link a Scopuly web wallet. It does not mention the SCOP token or yield claims.

## What we are proposing

The user pastes the Scopuly public key (G…). StellarTimeLock builds one unsigned transaction and hands it to Scopuly with a `web+stellar:tx` link. Scopuly signs with the key that stays in Scopuly. StellarTimeLock never asks for the S… secret and never puts it in the link.

This build does not open that link. `SCOPULY_SEP7_HANDOFF_ENABLED` is false. A real Soroban envelope needs Horizon (sequence number) and `simulateTransaction` before it is safe to sign, and that path is not testable offline here. The checks below are already implemented. The info screen does not call them.

## Confirm screen

A public review of Scopuly found that a claimable-balance lock can show on Scopuly's signing screen as only "Create Claimable Balance operation", with no amount, recipient, or unlock date.

Before any handoff, StellarTimeLock shows its own confirm screen with:

- the vault action, in plain language
- the amount
- the recipient public key (the account that receives the funds, or the account that is acting when no funds move)
- the unlock date, release date, deadline, or check-in date for that action

The link is not built until those four lines are filled in and the user confirms them. `prepareScopulyRequest` refuses a missing amount, a recipient that is not a G… key, or a missing date. It decodes the envelope and refuses the link when the amount, recipient, or unlock date on the screen is not the one in the operation. The five-minute timebound is the link expiry, not the unlock date.

For a check-in or a cancel, the amount line is still shown (`0 XLM — no funds move`, or the vault balance). The date line is the next deadline, not the word "unknown".

## One action, short expiry

Each request is a single operation. Timebounds `maxTime` is at most five minutes ahead of now (`HANDOFF_MAX_TTL_SEC = 300`). A second operation, a missing expiry, or a longer window is refused. The envelope we hand off is unsigned. Fee-bump envelopes are refused.

Where today's code submits two transactions (Multi-Sig deploy, then `initialize`; archived-vault restore, then TTL extend), those stay two separate requests. They are not combined into one link.

## `callback` and `origin_domain`

This build does not attach `callback`, `origin_domain`, or `signature`.

`callback` is not safe to turn on until a signed envelope that comes back is checked, and only then submitted:

1. Parse our original unsigned envelope and the returned envelope.
2. Refuse a fee-bump.
3. Require the transaction hash to match. That hash covers the transaction body and does not cover signatures, so the bodies are the same bytes and only signatures may differ.
4. Require a signature on that hash that verifies under the Scopuly public key the user entered.
5. Submit only if both checks pass.

`verifySignedReturn` does that check. Nothing in the app submits a returned envelope. A returned transaction that was altered, or signed by a different key, is rejected.

`origin_domain` is not safe until the request itself is signed. Proposal: publish an Ed25519 public key on https://stellartimelock.com and sign each `web+stellar:tx` request with the matching secret, using SEP-7 `origin_domain` (`stellartimelock.com`) and `signature`. The secret would not live in the Android app. Until that key is on the site, we omit `origin_domain` so a wallet cannot treat an unsigned domain as proof that StellarTimeLock built the request.

## Withdrawals do not depend on Scopuly

Create, withdraw, unlock, check-in, claim, and refund already sign with the key this wallet holds. Those screens do not import the Scopuly handoff. If Scopuly is offline, a person who holds their key in StellarTimeLock still withdraws and unlocks. A person who keeps the key only in Scopuly has chosen Scopuly as the signer. This app does not block its own vault actions on Scopuly being reachable.

## Vault actions that need a signature

Names are the contract methods (or Stellar operations) the app invokes today. Arguments are the ones the client already sends. Read-only calls (`get_vault`, list, unlocked amount) are not in this list.

### Standard Time-Lock

`src/api/soroban-client.ts`. The app signs locally via `invokeContract`.

| Action | Method | Arguments |
| --- | --- | --- |
| Create Time-Lock | `create_vault` | owner, name, initial deposit (i128 stroops), unlock timestamp (u64) |
| Deposit | `deposit` | owner, vault id, amount (i128) |
| Extend the lock | `extend_lock` | owner, vault id, additional seconds (u64) |
| Withdraw | `withdraw` | owner, vault id |
| Wake an archived vault | RestoreFootprint, then ExtendFootprintTtl | one signature each, two requests |

### Cooling-Off

`src/wallet/advanced-vaults/client.ts`.

| Action | Method | Arguments |
| --- | --- | --- |
| Create Cooling-Off | `create_cooling_off_vault` | owner, token, name, amount, cooling-off duration (seconds) |
| Start the notice | `initiate_withdrawal` | owner, vault id |
| Cancel the notice | `cancel_withdrawal` | owner, vault id |
| Release | `withdraw` | owner, vault id |

### Vesting

Same client. Multi-asset vesting uses the same `create_vesting_vault` method with a non-XLM token contract.

| Action | Method | Arguments |
| --- | --- | --- |
| Create Vesting | `create_vesting_vault` | owner, token, name, amount, start timestamp, end timestamp |
| Claim vested | `withdraw_vested` | owner, vault id, amount |

### Dead Man's Switch

| Action | Method | Who signs | Arguments |
| --- | --- | --- | --- |
| Create | `create_dead_man_switch_vault` | owner | owner, token, name, amount, backup address, inactivity period |
| Check-in | `ping` | owner | owner, vault id |
| Owner withdraw | `withdraw` | owner | owner, vault id |
| Backup release | `backup_withdraw` | backup address | backup, vault id |

### Multi-Sig

Deploy and initialize are two transactions today, so they would be two links.

| Action | Call | Arguments |
| --- | --- | --- |
| Deploy | `createCustomContract` | wasm hash, owner address |
| Initialize | `initialize` | owner, co-signer, token, amount, unlock timestamp |
| Ask to withdraw | `request_withdrawal` | owner, amount (i128), destination |
| Co-sign | `approve_withdrawal` | the approving account |
| Cancel the ask | `cancel_withdrawal` | the account cancelling |
| Claim | `claim` | no contract arguments; the source account still signs |
| Deposit | `deposit` | owner, amount (i128) |
| Extend the lock | `extend_lock` | owner, additional seconds (u64) |

### HTLC

| Action | Method | Who signs | Arguments |
| --- | --- | --- | --- |
| Create | `create` | sender | sender, recipient, hash, deadline, amount |
| Claim | `claim` | recipient | vault id, preimage |
| Refund | `refund` | sender | vault id |

### Multi-asset beta

`src/wallet/multi-asset-beta/client.ts`.

| Action | Method | Arguments |
| --- | --- | --- |
| Create | `create_vault` | owner, token contract, name, amount, unlock timestamp |
| Withdraw | `withdraw` | owner, vault id |

## Exact request flow

1. The user pastes their Scopuly public key. An S… secret is rejected.
2. The user picks one vault action from the table.
3. StellarTimeLock loads that account from Horizon (sequence, balances) and builds one operation. Source account is the Scopuly G… key.
4. Timebounds expire within five minutes.
5. StellarTimeLock calls `simulateTransaction`, assembles the unsigned envelope, and does not sign it.
6. StellarTimeLock shows the action, amount, recipient, and unlock date. The user confirms. If any line is missing, we stop.
7. We open `web+stellar:tx?xdr=<base64>&pubkey=<G…>&msg=<short label>`.
8. We do not add `callback`, `origin_domain`, or `signature` until the return check is on the submit path and the website key exists.
9. The user reviews and approves in the Scopuly app. Scopuly signs and can submit.
10. If a signed envelope is handed back instead, `verifySignedReturn` must pass before this app would submit it. This build does not submit it.

## Joint testnet check

We would like to run every row in the tables on testnet before any mainnet handoff. StellarTimeLock builds the unsigned XDR, Scopuly signs with a test key, and both sides check the result. Suggested pass for each row:

- Scopuly shows the request from the `web+stellar:tx` link.
- The user can see the amount, recipient, and date on the StellarTimeLock confirm screen even when Scopuly's own screen shows only the operation name.
- The signed envelope matches the unsigned one apart from signatures, and the signature is from the expected test key.
- A changed operation, an extra operation, a fee-bump, or a different signer is rejected.
- The link expires within five minutes.
- A withdraw or unlock signed inside StellarTimeLock still works while Scopuly is unreachable.

Mainnet stays off until that list passes.

## Request signing

After the testnet pass, publish the SEP-7 signing public key on https://stellartimelock.com. Sign each vault request (`origin_domain=stellartimelock.com` and `signature` per SEP-0007). Scopuly can then treat the request as coming from StellarTimeLock. This build does not attach those parameters.
