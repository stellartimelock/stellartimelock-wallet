package com.stellartimelock.tap

import android.content.ComponentName
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import android.os.Bundle
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import java.util.concurrent.atomic.AtomicReference

@ReactModule(name = TapPayModule.NAME)
class TapPayModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), TurboModule {

    private val readerPromise = AtomicReference<Promise?>(null)

    override fun getName(): String = NAME

    @ReactMethod
    fun nfcStatus(promise: Promise) {
        val adapter = NfcAdapter.getDefaultAdapter(reactContext)
        val map = Arguments.createMap()
        map.putBoolean("available", adapter != null)
        map.putBoolean("enabled", adapter?.isEnabled == true)
        promise.resolve(map)
    }

    @ReactMethod
    fun openNfcSettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_NFC_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (_: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun publishRequest(uri: String, promise: Promise) {
        if (!uri.startsWith("web+stellar:", ignoreCase = true)) {
            promise.reject("invalid_input", "invalid_input")
            return
        }
        TapPayRequestStore.setUri(uri)
        if (TapPayRequestStore.payload() == null) {
            promise.reject("invalid_input", "invalid_input")
            return
        }
        UiThreadUtil.runOnUiThread {
            preferThisService()
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun clearRequest(promise: Promise) {
        TapPayRequestStore.setUri(null)
        UiThreadUtil.runOnUiThread {
            clearPreferred()
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun startReader(promise: Promise) {
        val adapter = NfcAdapter.getDefaultAdapter(reactContext)
        val activity = reactContext.currentActivity
        if (adapter == null || !adapter.isEnabled || activity == null) {
            promise.reject("nfc_unavailable", "nfc_unavailable")
            return
        }
        val previous = readerPromise.getAndSet(promise)
        previous?.reject("canceled", "canceled")
        UiThreadUtil.runOnUiThread {
            try {
                adapter.enableReaderMode(
                    activity,
                    { tag ->
                        val iso = android.nfc.tech.IsoDep.get(tag) ?: return@enableReaderMode
                        try {
                            iso.connect()
                            iso.timeout = 1500
                            val uri = TapPayApdu.readUri(iso)
                            deliverRead(uri)
                        } catch (_: Exception) {
                            // Not our request. Keep the reader open.
                        } finally {
                            try {
                                iso.close()
                            } catch (_: Exception) {
                                /* Tag left the field. */
                            }
                        }
                    },
                    NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
                    Bundle(),
                )
            } catch (_: Exception) {
                readerPromise.getAndSet(null)?.reject("nfc_unavailable", "nfc_unavailable")
            }
        }
    }

    @ReactMethod
    fun stopReader(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            disableReader()
            readerPromise.getAndSet(null)?.reject("canceled", "canceled")
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun currentCheckout(promise: Promise) {
        val row = TapPaySessions.current()
        if (row == null) {
            promise.resolve(null)
            return
        }
        val map = Arguments.createMap()
        map.putString("action", row.action)
        map.putString("requestId", row.requestId)
        map.putString("amount", row.amount)
        map.putString("memo", row.memo)
        map.putString("destination", row.destination)
        map.putString("uri", row.uri)
        map.putString("label", row.label)
        promise.resolve(map)
    }

    @ReactMethod
    fun finishCheckout(result: ReadableMap, promise: Promise) {
        val requestId = if (result.hasKey("requestId")) result.getString("requestId") else null
        if (requestId.isNullOrBlank()) {
            promise.resolve(false)
            return
        }
        val ok = result.hasKey("ok") && result.getBoolean("ok")
        val extras = Bundle()
        extras.putString(TapPayContract.EXTRA_REQUEST_ID, requestId)
        copyString(result, "hash", TapPayContract.EXTRA_HASH, extras)
        copyString(result, "amount", TapPayContract.EXTRA_AMOUNT, extras)
        copyString(result, "destination", TapPayContract.EXTRA_DESTINATION, extras)
        copyString(result, "payer", TapPayContract.EXTRA_PAYER, extras)
        copyString(result, "error", TapPayContract.EXTRA_ERROR, extras)
        promise.resolve(TapPaySessions.finish(requestId, ok, extras))
    }

    private fun deliverRead(uri: String) {
        val pending = readerPromise.getAndSet(null) ?: return
        UiThreadUtil.runOnUiThread {
            disableReader()
            pending.resolve(uri)
        }
    }

    private fun disableReader() {
        val adapter = NfcAdapter.getDefaultAdapter(reactContext) ?: return
        val activity = reactContext.currentActivity ?: return
        try {
            adapter.disableReaderMode(activity)
        } catch (_: Exception) {
            /* Reader was not enabled. */
        }
    }

    private fun preferThisService() {
        val adapter = NfcAdapter.getDefaultAdapter(reactContext) ?: return
        val activity = reactContext.currentActivity ?: return
        try {
            // Foreground preference for the non-payment AID group only.
            // This does not set the default payment app.
            val emulation = CardEmulation.getInstance(adapter)
            emulation.setPreferredService(
                activity,
                ComponentName(reactContext, TapPayHceService::class.java),
            )
        } catch (_: Exception) {
            /* The request screen is still the foreground app, which is enough. */
        }
    }

    private fun clearPreferred() {
        val adapter = NfcAdapter.getDefaultAdapter(reactContext) ?: return
        val activity = reactContext.currentActivity ?: return
        try {
            CardEmulation.getInstance(adapter).unsetPreferredService(activity)
        } catch (_: Exception) {
            /* Already cleared. */
        }
    }

    private fun copyString(result: ReadableMap, key: String, extra: String, extras: Bundle) {
        if (!result.hasKey(key) || result.isNull(key)) return
        val value = result.getString(key) ?: return
        if (value.isNotEmpty()) extras.putString(extra, value)
    }

    companion object {
        const val NAME = "TapPay"
    }
}
