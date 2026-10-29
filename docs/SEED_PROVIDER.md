# Seed provider

Stellar TimeLock (`com.stellartimelock`) is where sibling apps get the seed they use to open a save file. Ask this app instead of shipping a seed wizard.

The seed is a Stellar secret (`S…`) already stored in Key Manager. This flow does not change the wallet's save format and does not device-lock save files. Hold the seed in memory only while you open the file, then drop it. Do not log it, copy it to the clipboard, put it in a URL, or write it to disk.

The wallet does not log the seed either.

## Permission

```xml
<uses-permission android:name="com.stellartimelock.wallet.permission.PICK_KEY" />
```

`com.stellartimelock.wallet.permission.PICK_KEY` is a `signature` permission. Android grants it only when the caller is signed with the same certificate as Stellar TimeLock. There is no package allowlist. Install Stellar TimeLock before (or in the same session as) the caller, or the permission is not granted.

Callers must be signed with the same certificate as this app. See the README section "Signing".

Give the sibling a launcher activity (`MAIN` / `LAUNCHER`). The confirm screen reads that app's label and icon. A sibling with no launcher icon can still be denied on Android 11+, because this app cannot see its name.

Target package for the intent: `com.stellartimelock`. That is not the iOS bundle id `com.stellartimelock.wallet`.

```xml
<queries>
  <package android:name="com.stellartimelock" />
</queries>
```

## Intent

Action: `com.stellartimelock.wallet.action.PICK_KEY`

Category: `android.intent.category.DEFAULT` (added for you when you use `Intent` with an action and `startActivityForResult`).

Set the package to `com.stellartimelock` so the intent cannot be intercepted.

## Extras you send

| Extra | Type | Required | Meaning |
| --- | --- | --- | --- |
| `requestId` | string | yes | A non-empty id you generate (a UUID is fine). It is echoed in the result so you can ignore a stale reply. |

Do not send any other extras. Do not send a seed.

## What the user sees

1. A confirm screen with the sibling's icon and the sentence `{App name} wants your seed to open its save file`.
2. If Key Manager has more than one seed, the same screen asks which one to share. The secret is not shown.
3. After the user taps Allow, the system asks for a Class 3 biometric (fingerprint). A device PIN, pattern, or password is not accepted. A device with no Class 3 biometric cannot share a seed.

Cancel, or a failed check, returns `RESULT_CANCELED`.

## Result

`RESULT_OK` — the result intent carries these string extras:

| Extra | Meaning |
| --- | --- |
| `requestId` | The id you sent |
| `keyId` | Key Manager entry id |
| `label` | The name saved on that entry |
| `secret` | The seed (`S…`, 56 characters). Memory only |

`secret` is the seed. Use it to open the save file, then drop every copy.

`RESULT_CANCELED` — the result intent may include:

| Extra | Meaning |
| --- | --- |
| `requestId` | The id you sent, when one was accepted |
| `error` | A code. Never key material |

`error` values:

| Code | Meaning |
| --- | --- |
| `caller_not_allowed` | Missing permission, different signing certificate, or the caller could not be identified |
| `request_id_required` | `requestId` was missing or blank |
| `biometric_unavailable` | The device has no Class 3 biometric enrolled |
| `biometric_failed` | The biometric check failed |
| `canceled` | The user canceled |
| `no_keys` | Key Manager has no secret seed on this device |

## Kotlin

```kotlin
private val pickSeed = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult()
) { result ->
    val data = result.data
    if (result.resultCode != Activity.RESULT_OK || data == null) {
        val error = data?.getStringExtra("error") ?: "canceled"
        onSeedDenied(error)
        return@registerForActivityResult
    }
    val secret = data.getStringExtra("secret").orEmpty()
    try {
        openSaveFile(secret)
    } finally {
        // Drop the reference. Do not log secret.
    }
}

fun requestSeed() {
    val intent = Intent("com.stellartimelock.wallet.action.PICK_KEY").apply {
        setPackage("com.stellartimelock")
        putExtra("requestId", UUID.randomUUID().toString())
    }
    pickSeed.launch(intent)
}
```

Manifest (in the sibling app):

```xml
<uses-permission android:name="com.stellartimelock.wallet.permission.PICK_KEY" />

<queries>
  <package android:name="com.stellartimelock" />
</queries>
```

## React Native

Add the permission and `<queries>` block above to the sibling app's `AndroidManifest.xml`. Then add these two Kotlin files and register the package from `MainApplication.getPackages()`:

```kotlin
packages.add(StellarSeedPackage())
```

`android/app/src/main/java/com/example/sibling/StellarSeedModule.kt`:

```kotlin
package com.example.sibling

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class StellarSeedModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    private var pending: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = "StellarSeed"

    @ReactMethod
    fun pick(requestId: String, promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("canceled", "canceled")
            return
        }
        if (pending != null) {
            promise.reject("canceled", "canceled")
            return
        }
        pending = promise
        val intent = Intent("com.stellartimelock.wallet.action.PICK_KEY").apply {
            setPackage("com.stellartimelock")
            putExtra("requestId", requestId)
        }
        try {
            activity.startActivityForResult(intent, REQUEST_PICK_SEED)
        } catch (_: Exception) {
            pending = null
            promise.reject("caller_not_allowed", "caller_not_allowed")
        }
    }

    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?,
    ) {
        if (requestCode != REQUEST_PICK_SEED) return
        val promise = pending ?: return
        pending = null
        if (resultCode != Activity.RESULT_OK || data == null) {
            val error = data?.getStringExtra("error") ?: "canceled"
            promise.reject(error, error)
            return
        }
        val secret = data.getStringExtra("secret")
        if (secret.isNullOrEmpty()) {
            promise.reject("canceled", "canceled")
            return
        }
        val map = Arguments.createMap().apply {
            putString("requestId", data.getStringExtra("requestId"))
            putString("keyId", data.getStringExtra("keyId"))
            putString("label", data.getStringExtra("label"))
            putString("secret", secret)
        }
        promise.resolve(map)
    }

    override fun onNewIntent(intent: Intent) {}

    companion object {
        private const val REQUEST_PICK_SEED = 4811
    }
}
```

`android/app/src/main/java/com/example/sibling/StellarSeedPackage.kt`:

```kotlin
package com.example.sibling

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class StellarSeedPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(StellarSeedModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
```

JavaScript:

```javascript
import { NativeModules, Platform } from "react-native";

export async function requestStellarSeed(requestId) {
  if (Platform.OS !== "android") {
    throw new Error("canceled");
  }
  const bridge = NativeModules.StellarSeed;
  if (!bridge || typeof bridge.pick !== "function") {
    throw new Error("caller_not_allowed");
  }
  // { requestId, keyId, label, secret }
  // Use secret to open the save file, then drop it. Do not log it.
  return bridge.pick(requestId);
}
```

Replace `com.example.sibling` with the sibling app's package. The intent package stays `com.stellartimelock`.
