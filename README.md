# Stellar TimeLock wallet

Source code for the Stellar TimeLock Android wallet (Expo / React Native). Source available on GitHub under the GNU GPL v3.0 or later; see [LICENSE](LICENSE).

## Build

Requirements: Node 20+, JDK 17, Android SDK.

```bash
npm ci
npm test
npx expo run:android            # debug build on a device or emulator
```

The Android app has two build flavors:

- `play`: the Google Play / sideload build.
- `fdroid`: no Firebase/FCM, Google Play services, ML Kit or Play install referrer; QR scanning uses ZXing.

```bash
cd android
./gradlew assembleFdroidRelease -Pexpo.camera.barcode-scanner-enabled=false
```

Debug builds use `android/app/debug.keystore`, which is not in this repository. Create your own (use the alias and passwords in `signingConfigs.debug` in `android/app/build.gradle`):

```bash
keytool -genkeypair -v -keystore android/app/debug.keystore -alias androiddebugkey \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
```

Configuration (optional): copy `.env.example` to `.env`. Never put a secret in an `EXPO_PUBLIC_*` variable; those values are built into the app. Swaps go through the swap proxy in [proxy/](proxy/), which holds the SimpleSwap partner keys server-side.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## App details

Android application id: `com.stellartimelock`.

That id does **not** match `com.stellartimelock.wallet` (the iOS bundle id) or `com.stellartimelock.stellartimelock`. Callers of the key picker must target `com.stellartimelock`.

Secret seeds stay in this app's Key Manager. They are not sent to other apps for storage. This app is the seed provider: sibling apps ask here instead of running their own seed wizard. Copy-paste Kotlin and React Native snippets are in [docs/SEED_PROVIDER.md](docs/SEED_PROVIDER.md).

Phone-to-phone XLM checkout is documented in [docs/TAP_TO_PAY.md](docs/TAP_TO_PAY.md). Market and Delivery Driver call `REQUEST_PAY` or `PAY`. The same signature certificate is required, and the person holding the phone still confirms the full amount and recipient.

## Key picker API

Any app signed with the same certificate can ask for a Key Manager seed to open its save file. The confirm screen shows that app's name and icon, then the user confirms with biometrics or a device PIN. The seed is returned in memory only. This app does not log it, copy it to the clipboard, put it in a URL, or write the picker result to disk. Callers must treat it the same way. Save files stay seed-derived; this flow does not device-lock them.

### Permission

```xml
<uses-permission android:name="com.stellartimelock.wallet.permission.PICK_KEY" />
```

The permission is `signature`. There is no package allowlist. The caller must be signed with the same certificate as this app.

Install this app before a caller that uses the permission. Android only grants a signature permission when the defining app is already present (or is installed in the same session) and the certificates match.

### Activity (`startActivityForResult`)

Action: `com.stellartimelock.wallet.action.PICK_KEY`

Set the package to `com.stellartimelock`. Send a non-empty `requestId` string extra. Do not send any other extras.

```kotlin
val intent = Intent("com.stellartimelock.wallet.action.PICK_KEY").apply {
    setPackage("com.stellartimelock")
    putExtra("requestId", requestId)
}
startActivityForResult(intent, REQUEST_PICK_KEY)
```

On `RESULT_OK`, the result intent contains these string extras:

| Extra | Meaning |
| --- | --- |
| `requestId` | The id you sent |
| `keyId` | Key Manager entry id |
| `label` | The name the user saved |
| `secret` | Stellar secret seed (`S…`). Memory only |

On cancel, `RESULT_CANCELED` may include `requestId` and an `error` code (`caller_not_allowed`, `request_id_required`, `biometric_unavailable`, `biometric_failed`, `canceled`, `no_keys`). `error` is never key material.

The flow is a confirm screen (`{App name} wants your seed to open its save file`, with that app's icon), then biometrics or the device PIN/pattern/password. If Key Manager has more than one seed, the same screen asks which one to share. The secret is not shown. On Android 11 and later the system sheet can offer either biometric or PIN; older devices use whichever of the two is enrolled.

### Bound service

Action: `com.stellartimelock.wallet.action.PICK_KEY`  
Service: `com.stellartimelock.keys.KeyPickerService`  
Binder: `com.stellartimelock.wallet.IKeyPicker`

```kotlin
val intent = Intent("com.stellartimelock.wallet.action.PICK_KEY").apply {
    setPackage("com.stellartimelock")
}
bindService(intent, connection, Context.BIND_AUTO_CREATE)
```

```kotlin
val picker = IKeyPicker.Stub.asInterface(binder)
picker.pickKey(requestId, object : IKeyPickerCallback.Stub() {
    override fun onPicked(requestId: String, keyId: String, label: String, secret: String) {
        // secret is in memory only
    }
    override fun onCanceled(requestId: String, reason: String) {}
})
```

`onPicked` carries the same four fields as the activity result. The callback is `oneway`. The service opens the same confirm screen. AIDL sources live in `android/app/src/main/aidl/com/stellartimelock/wallet/`. The activity result is the contract documented in [docs/SEED_PROVIDER.md](docs/SEED_PROVIDER.md).

## Signing

`PICK_KEY` and the tap-to-pay actions are `signature` permissions: they are only granted to apps signed with the same certificate as this app. Official builds are signed with a private key that is not in this repository. Official APKs published outside Google Play are signed with certificate SHA-256 `b9:3f:0f:85:e1:aa:14:7b:64:6a:36:f4:15:f8:7e:f4:9b:f1:4e:9f:a9:fa:be:e0:f1:ba:4c:48:b7:b8:b1:de`. If you build the app yourself, sign it with your own key; your build will not be able to talk to the official app or official sibling apps, and it installs as a separate app only if you change the application id.

## Quick Settings

Android exposes three tiles. Add them from the Quick Settings editor. They open the existing screens and do not restyle the wallet.

| Tile | Opens |
| --- | --- |
| Receive XLM | The receive screen and its address QR |
| Send XLM | Send, with the favorites picker already open |
| Balance | The wallet balance, after a biometric check. The amount is not shown on the tile |

## Key Manager save file

Key Manager writes `key-manager.json` under the app documents directory (`stellartimelock/`). The replace is atomic (temp file, then rename). Previous copies are kept as `.bak1` through `.bak5` (`.bak5` is the oldest and is dropped on the next rotation). If the new file would be empty or smaller than the current file, the app asks before overwriting. The picker only reads Key Manager; it does not write this file.

Tap to pay uses the same save rules for `stellartimelock/tap-pay.json` (limits, nonces, and payment history).
