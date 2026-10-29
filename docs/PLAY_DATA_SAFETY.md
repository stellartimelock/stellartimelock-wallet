# Play Data safety answers — 8 October 2026

Paste these into the Play Console Data safety form. They match the app as of this branch (package `com.stellartimelock`, version 1.6.11). If a later build adds analytics, an account, or a new host, update this file first.

## App content / financial features

- The app is a **non-custodial cryptocurrency wallet**.
- It does **not** hold customer funds, transmit money for others, or act as a bank, exchange, or broker.
- Users sign Stellar transactions on the phone. Network fees are Stellar fees, burned by the network.
- Swaps are handed to SimpleSwap. The app discloses that in the in-app legal page.

## Data safety — top questions

| Question | Answer |
| --- | --- |
| Does the app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only for Horizon, RPC, SimpleSwap, and the pairing relay) |
| Do you provide a way for users to request that their data is deleted? | **No.** There is no account. Uninstall removes on-phone data. Copies already sent to Horizon, RPC hosts, or SimpleSwap are not deleted by us. Email stellartimelock@gmail.com with a privacy question. |
| Do you sell user data? | **No** |

"Collected" here means transmitted off the phone, which is how Play defines it. Data that stays on the phone is described in the privacy policy and is not marked collected below.

## Data types

| Play type | Collected? | Shared? | Purpose | Optional? | Notes |
| --- | --- | --- | --- | --- | --- |
| Location | No | No | — | — | No location permission |
| Personal info (name, email, phone, address) | No | No | — | — | We do not ask for these |
| Address book | No | No | — | — | The in-app address book stays on the phone |
| Financial info → Other financial info | Yes | Yes | App functionality | No | Public account id and transactions are sent to Stellar Horizon and Soroban RPC when the user sends, opens a vault, or looks up a balance. A swap also sends the pair, amount, and deposit address to SimpleSwap |
| Photos | No | No | — | — | Camera is used to scan a QR. The image is not stored or uploaded |
| Audio | No | No | — | — | Microphone permission removed. The app does not record audio |
| Files and docs | No | No | — | — | Backups the user exports stay in the folder they pick |
| App activity / analytics | No | No | — | — | Firebase analytics in this build is a no-op |
| Device or other IDs | No | No | — | — | We do not read the advertising id. Third parties see the phone's IP address as part of the HTTPS connection. We do not store it |
| Web browsing | No | No | — | — | No WebView |

## Third parties that receive data

| Host | What they receive | Why |
| --- | --- | --- |
| `horizon.stellar.org` | Public account id and transactions | Balances and payments |
| Soroban RPC: Ankr (`rpc.ankr.com`), plus the fallbacks in `src/wallet/contract-config.ts` | Public account id, contract calls, fees | Vaults |
| `stl-swap-proxy.stellartimelock.workers.dev` (forwards to `api.simpleswap.io`) | Swap pair, amount, payout and refund addresses. No key leaves the phone; the proxy adds the partner key. No logs, no storage. | Only while the user is swapping |
| `fortress-bot.stellartimelock.workers.dev` | Pairing session id and sealed ciphertext | Encrypted Key Manager pairing. The worker source is not in this repo. The phone gives up after about 90 seconds |
| `stellar.expert` | Public transaction id, only if the user opens the link | Explorer |

## Permissions to declare (and ones removed)

Still in the merged release manifest:

- `INTERNET`
- `USE_BIOMETRIC`, `USE_FINGERPRINT` — unlock and PICK_KEY
- `NFC` — Request or pay link, not a card payment
- `CAMERA` — Key Manager pairing QR (`app/key-manager-pair.tsx`). The picture is not saved or uploaded
- `POST_NOTIFICATIONS` — local vault-unlock reminders scheduled on this phone
- `RECEIVE_BOOT_COMPLETED` — reschedule those reminders after a reboot
- `VIBRATE` — notification vibration
- `com.android.vending.BILLING` — Play purchases for tiers
- Storage read/write limited to SDK 32 for older file picking
- Signature permissions this app defines: `com.stellartimelock.wallet.permission.PICK_KEY`, `com.stellartimelock.timelock.permission.TAP_PAY`
- `com.stellartimelock.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` — AndroidX signature permission, not a Play data type
- `ACCESS_NETWORK_STATE` — merged from Glide so image loads can retry after the network returns
- `WAKE_LOCK` — still merged from the notifications library. Unlock reminders are local alarms. They do not use Firebase Cloud Messaging

Confirmed from the release merged manifest (`:app:processReleaseMainManifest`).

Removed from the merged release manifest with `tools:node="remove"`:

- `com.google.android.c2dm.permission.RECEIVE` — FCM push. This wallet has no push backend. The Firebase messaging receiver and services are removed from the manifest too
- `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` — Play install referrer. Nothing in the app reads it
- Launcher badge permissions from ShortcutBadger (Samsung, HTC, Sony, Huawei, OPPO, and the others in that library). The app does not set a badge
- `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, media playback foreground service
- `READ_CONTACTS`, `WRITE_CONTACTS`
- `REQUEST_INSTALL_PACKAGES`
- `SYSTEM_ALERT_WINDOW`

## Privacy policy URL

The same text ships in the app at Settings → legal → Privacy (`app/legal/privacy.tsx`). The Play listing URL should be the page on stellartimelock.com once that page matches this text. Contact: stellartimelock@gmail.com.

## Target API

Release target SDK is **36** (React Native `gradle/libs.versions.toml`, used by the Expo root plugin). `android:allowBackup` is `false`. Release minify (R8) is on.
