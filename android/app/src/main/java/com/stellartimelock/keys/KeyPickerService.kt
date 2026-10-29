package com.stellartimelock.keys

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.RemoteException
import com.stellartimelock.keys.KeyPickerContract.ACTION_PICK_KEY
import com.stellartimelock.keys.KeyPickerContract.ERROR_CALLER_NOT_ALLOWED
import com.stellartimelock.keys.KeyPickerContract.ERROR_REQUEST_ID_REQUIRED
import com.stellartimelock.keys.KeyPickerContract.EXTRA_REQUEST_ID
import com.stellartimelock.keys.KeyPickerContract.EXTRA_SESSION
import com.stellartimelock.wallet.IKeyPicker
import com.stellartimelock.wallet.IKeyPickerCallback

/**
 * Bound-service variant of [ACTION_PICK_KEY]. The system enforces the
 * signature permission. This process also checks the signing certificate,
 * then opens [KeyPickerActivity] for the confirm screen. The secret
 * travels only through the binder callback and is never logged.
 */
class KeyPickerService : Service() {
    private val main = Handler(Looper.getMainLooper())

    private val binder = object : IKeyPicker.Stub() {
        override fun pickKey(requestId: String?, callback: IKeyPickerCallback?) {
            if (callback == null) return
            val uid = Binder.getCallingUid()
            val callerPackage = KeyPickerGuard.callerPackageForUid(this@KeyPickerService, uid)
            if (callerPackage == null || !KeyPickerGuard.isUidAllowed(this@KeyPickerService, uid)) {
                safeCancel(callback, requestId ?: "", ERROR_CALLER_NOT_ALLOWED)
                return
            }
            val req = requestId?.trim().orEmpty()
            if (req.isEmpty()) {
                safeCancel(callback, "", ERROR_REQUEST_ID_REQUIRED)
                return
            }
            val handle = KeyPickerSessions.register(req, callback, callerPackage)
            val launch = Intent(this@KeyPickerService, KeyPickerActivity::class.java).apply {
                action = ACTION_PICK_KEY
                putExtra(EXTRA_REQUEST_ID, req)
                putExtras(Bundle().apply { putBinder(EXTRA_SESSION, handle) })
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            main.post {
                try {
                    startActivity(launch)
                } catch (_: Exception) {
                    KeyPickerSessions.cancel(handle)
                    safeCancel(callback, req, ERROR_CALLER_NOT_ALLOWED)
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? {
        if (intent?.action != ACTION_PICK_KEY) return null
        return binder
    }

    private fun safeCancel(callback: IKeyPickerCallback, requestId: String, reason: String) {
        try {
            callback.onCanceled(requestId, reason)
        } catch (_: RemoteException) {
            // Caller is gone.
        }
    }
}
