package com.stellartimelock.keys

/**
 * Public contract for the wallet key picker.
 *
 * Android applicationId is `com.stellartimelock`. That is the package callers
 * pass to Intent.setPackage. It is not `com.stellartimelock.wallet` (the iOS
 * bundle id) and not `com.stellartimelock.stellartimelock`.
 */
internal object KeyPickerContract {
    const val ACTION_PICK_KEY = "com.stellartimelock.wallet.action.PICK_KEY"
    const val PERMISSION_PICK_KEY = "com.stellartimelock.wallet.permission.PICK_KEY"

    const val EXTRA_REQUEST_ID = "requestId"
    const val EXTRA_KEY_ID = "keyId"
    const val EXTRA_LABEL = "label"
    const val EXTRA_SECRET = "secret"
    const val EXTRA_ERROR = "error"

    /** In-process binder handle. Not part of the public caller contract. */
    const val EXTRA_SESSION = "com.stellartimelock.wallet.extra.SESSION"

    const val ERROR_CALLER_NOT_ALLOWED = "caller_not_allowed"
    const val ERROR_REQUEST_ID_REQUIRED = "request_id_required"
    const val ERROR_BIOMETRIC_UNAVAILABLE = "biometric_unavailable"
    const val ERROR_BIOMETRIC_FAILED = "biometric_failed"
    const val ERROR_CANCELED = "canceled"
    const val ERROR_NO_KEYS = "no_keys"
}

/** Confirm-screen sentence. [appName] is the requesting app's label. */
internal fun seedShareMessage(appName: String): String =
    "$appName wants your seed to open its save file"

