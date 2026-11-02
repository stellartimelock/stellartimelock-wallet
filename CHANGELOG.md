# Changelog

## Unreleased (rides in the next normal release)
- Scopuly is back: the compact Scopuly row on Home ("Connect this wallet"), the Scopuly screen with its icon, X and Play badges, and the Scopuly SEP-7 vault handoff code (`web+stellar:tx`, no callback). The handoff stays off (`SCOPULY_SEP7_HANDOFF_ENABLED = false`) and is tested on Testnet first; nothing signs or submits through Scopuly on mainnet. Tap-to-pay pay links are unchanged. No stored data or keys change.

## 1.6.19 (versionCode 30)
- First release with the `fdroid` build flavor: no Firebase/FCM, Google Play services, ML Kit or install referrer; QR pairing uses ZXing. The Play build is unchanged.
- Source published at https://github.com/stellartimelock/stellartimelock-wallet (GPL-3.0-or-later).

## 1.6.18 (versionCode 29)
- Swap goes through the StellarTimeLock swap proxy (Cloudflare Worker, source in `proxy/`). The app no longer contains a SimpleSwap partner key.
- Removed Google Play Billing (react-native-iap) and the BILLING permission. Paid tiers were never launched.
- Removed unused react-native-dotenv; @expo/ngrok is a dev dependency only.
- Privacy and data-safety text updated for the proxy.

## 1.6.17

- Wallet: a saved wallet with no fingerprint on the phone and no seed in memory used to open to an almost empty "unlocking" screen with no way forward. The wallet tab now shows the lock screen with a message and a "Use seed instead" button that opens the existing seed entry for the active wallet. The seed must open that wallet's G address or it is refused. It stays in memory only; no new storage and no key names changed. The same message and button appear when the phone has no fingerprint, when a fingerprint attempt fails, or when the prompt hasn't answered after 8 seconds. When the phone has a fingerprint, "Try fingerprint again" is next to it. The release signing key is the same one as before.

## 1.6.16

- Send: Destination type is now the first thing on the screen, in a bright outlined card with a large label. The selected type is filled in with a checkmark, and the type you're sending to is pinned right above the Review & send button ("Sending to: Private Wallet", plus "memo required" for Exchange and Casino). Private Wallet is still the default. Names and order are unchanged.
- Send: A swap hand-off, or an address that is a swap deposit this wallet created, locks the type to Exchange / Custodial so the memo requirement can't be switched off.
- Swap: "How would you like to send?" moved up under the safety check, above the deposit card, so it's visible without scrolling. It has a large high-contrast label, and Send from Wallet is marked Default. Same three options in the same order. All 1.6.15 memo protections stay. The release signing key is the same one as before.

## 1.6.15

- Swapping XLM no longer asks you to send it yourself. After you tick the safety check, "Send from Wallet" opens a confirm sheet with the amount, SimpleSwap's deposit address and SimpleSwap's memo. Confirm, and the wallet signs and submits the payment with that exact memo. If SimpleSwap returns no memo, the swap can't be sent and says so. The Show QR and Copy manually options are still there.
- A payment to a swap deposit address without its memo is blocked, whatever destination type is picked. The wallet remembers the deposit addresses and memos of the swaps it creates, and every send path checks them before it signs. An address that declares it needs a memo (SEP-29 `config.memo_required`) is blocked without one too. The release signing key is the same one as before.

## 1.6.11

- iblitzc0de's wallet (`GAJT5MLVAFGNEHEBCPKLV7UV4VGY2MUSPOKVVPNF2MVYLXJDBVKWC26G`) is lifetime Elite. Subscription expiry, vault limits, and deposit limits do not move it off Elite.
- Fingerprint unlock no longer has a side door. If a wallet was set to ask for a fingerprint, the seed is not read from the unlocked copy on the phone. A cancelled fingerprint returns nothing. An older unlocked copy is moved behind the fingerprint and then removed. Turning fingerprint unlock off asks first, and says you will need to type the seed next time. Backup files are unchanged. They still open with the seed on this phone or another phone. Lock clears the seed from memory. The release signing key is the same one as before.

## 1.6.10

- A new time lock, cooling-off vault, vesting vault, dead man's switch, multi-sig vault, or hash lock needs at least 10 XLM. The create screen says "Locks need at least 10 XLM" and will not continue. Wallets on the permanent Elite list are exempt. Send and receive are unchanged. Adding more to a lock you already have is unchanged. Inheritance and Lock and earn are not built yet; they use the same 10 XLM rule when they are. The HTLC contract source checks the same floor on create only. Claiming or refunding an older lock is unchanged. The live contracts are not upgraded in this release, so the phone blocks a small lock before it asks you to sign. The release signing key is the same one as before.

## 1.6.9

- Smart address book was empty when the saved contacts were already a list. The reader parsed that list a second time, the parse threw, and the screen showed no contacts. The contacts were still on the phone. Older shapes (a JSON string, an envelope address list, and rows that used name, address, and memo) now show up. A seed-sealed copy of the same list opens with the seed already in the app. Nothing is rewritten on read.
- The same list, on Home and on Send, also includes every saved wallet by name, each Key Manager public address by its label, and a vault counterparty when that address is a public G… key. An address that appears more than once is shown once. The contact name and memo stay. Secrets stay off this screen. The phone’s contact list is still not read.

## 1.6.8

- Restore opens a backup made by 1.0.0–1.6.3. Those files are cipher v2. The writer called CryptoJS PBKDF2 without a hash name, and crypto-js 4.2.0 uses SHA-256 for that. 1.6.4–1.6.7 decrypted them with SHA-1, so the check failed and the screen said the seed was different. The seed was the same one already in the app. Restore now tries that SHA-256 key, then the SHA-1 key, plus a trimmed or differently cased spelling of the same seed. A failure names the file, the layout it detected, and whether the seed did not match or the layout is unknown. Nothing is deleted.

## 1.6.7

- Restore names the file. A Key Manager save, a Fortress file, or anything else that is not a wallet backup gets a plain note, not a red “Decryption failed”. 1.6.8: a 1.0–1.6.3 backup still did not open. See 1.6.8. The 1.6.6 Key Manager change is not what made restore fail.
- The Scopuly Play button only opens the Play Store listing. “Open Scopuly with my address” is the only button that copies the public address.
- The “STL wallet by StellarTimeLock” byline is gone. The app name stays Stellar TimeLock.

## 1.6.6

- First launch after an upgrade no longer freezes the screen. Opening Key Manager was running 100,000 PBKDF2 rounds on the JavaScript thread (three times when an older plaintext save was sealed). That work now yields so the price and the buttons stay live, and a short “Updating your wallet…” line shows while it runs. The old file is still copied aside before it is replaced.
- Home, Settings, and the other visible screens drop Assistant, Bills, the money section, Coming soon, and the other-apps list again. Request or pay stays on Send. A tap still never sends. Stored money and bills data is left on the phone.
- A compact Scopuly row is back on Home. It opens the existing Scopuly screen (comparison, open with this address, X, and Play).

## 1.6.5

- Restores the 1.6.0 Aurora Glass screens. The 1.6.4 site-teal header and website logo are gone. Those sat on top of the working buttons, so taps did nothing.
- Security fixes, seed-encrypted Key Manager, cipher v3 (v1 and v2 still open), and the stripped Play permissions stay. No backend, no phone contacts, no microphone.
- Scopuly remains an ordinary screen with a back button. SEP-7 stays off.
- Key Manager no longer returns before its hooks. Opening it had crashed the app.

## 1.6.4

- Site teal layout from stellartimelock.com. Compact type. Gold for warnings. Header links: Wallet, Vaults, Send, Settings.
- Launcher icon is a simplified cube on `#05070d`. Splash and the in-app header keep the full logo.
- Removed Coming soon, Assistant, Bills, and the Settings list of other apps. Request or pay stays on Send. A tap still never sends.
- Scopuly info page, with the official icon, X mark, and Play badge. Links are the Play app and X only. The button copies the public address. The secret key stays here.
- SEP-7 vault handoff is built and left off. A future link has to show amount, recipient, and unlock date on our screen first, carry one action, and expire within five minutes. `callback` and `origin_domain` are not attached. A signed return has to match the transaction we built and be signed by the expected key. Withdraw and unlock do not call Scopuly.
- Older saves still open. Money and bills fields in an old backup are ignored. A new write keeps a `.bak` and will not replace a longer file with a shorter one.

## 1.6.0

- Fingerprint unlock restores the 32-byte derived signing key after the seed was typed once. The S… seed stays in memory. The wallet switcher uses the same path and no longer forces a seed re-entry when biometrics succeed.
- Choosing a backup is one flow: pick the file, confirm, restore, land in the restored wallet.
- Coming soon (payouts and shopping trends) is tucked under Later, below real wallet actions. Still placeholders only.
- Elite Dashboard is calmer: plain labels, watched total, arrange options hidden until you ask.
- Request or pay is the wallet-home entry. Settings no longer duplicates it. A tap never sends — fingerprint plus an in-app confirm. Optional one-time allow for a new address over the cap, optional authenticator code for new addresses.
- Bills live in Finance. The wallet keeps a local list and a lock-in-a-vault shortcut.
- Assistant copy is shorter, spaced out, and does not name any exchange brand.

## 1.5.0

- Swaps run from any supported currency to any other supported currency when SimpleSwap lists the pair: any to XLM, XLM to any, and any to any. SOL → XLM still pays into the in-app wallet. The screen has from and to pickers, a live quote, the provider minimum and maximum, and a clear error when a pair is not offered.
- Affiliate fee follows the pair. Cheap, fast, useful coins are utility at 0.4% (XLM, SOL, USDC, USDT, XRP, LTC, TRX, ALGO, ADA, HBAR, NANO/XNO, IOTA, POL/MATIC, AVAX, DOT, ATOM, NEAR, TON, LINK). Heavy is the 1% Bitcoin tax for BTC, ETH, BNB, BCH, DOGE, and BSV. Anything else is meme at 1.4%. A destination of XLM or USDC always uses the utility key. Otherwise the higher tier of the two coins wins. Each tier is a SimpleSwap partner key injected at build time. A missing tier key uses the utility key.

## 1.4.0

- Phone-to-phone tap to pay in XLM. The receiver shows a payment request (amount in XLM or USD at the live DEX rate, optional memo, and their address) over NFC host card emulation with a proprietary non-payment AID. The payer reviews the full amount and recipient, confirms with biometrics, and the app signs with the seed-derived key. QR codes and `web+stellar:pay` links are the fallback. Per-payment and daily limits, a two-minute nonce, a first-time recipient warning, and the testnet switch sit in front of every signature. Sibling apps can start checkout with `REQUEST_PAY` and `PAY`.

## 1.3.0

- Android Quick Settings tiles: Receive XLM opens the address QR, Send XLM opens send with the favorites picker, and Balance opens the wallet balance only after biometric. The wallet screens themselves are unchanged.

## 1.2.3

- Stellar TimeLock is the seed provider for sibling apps. Any app signed with the same certificate can request a Key Manager seed through `PICK_KEY`. The confirm screen shows that app's name and icon ("App X wants your seed to open its save file"), then biometrics or device PIN. The seed is returned in the activity result and is not logged. Save files stay seed-derived; they are not device-locked.

## 1.2.2

- Add `GCTWHBAAXP44OF74KEOZU7QEJXJBASDMJ3UDJRGBEY35EMVHAE76RYNW` to `PERMANENT_ELITE_ACCOUNTS`. The account always resolves to Elite and is not downgraded by subscription expiry, vault limits, or deposit limits.
