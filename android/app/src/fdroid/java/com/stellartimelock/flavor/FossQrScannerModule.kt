package com.stellartimelock.flavor

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanIntentResult
import com.journeyapps.barcodescanner.ScanOptions

/**
 * QR scanner for the F-Droid flavor, built on ZXing (zxing-android-embedded, Apache-2.0).
 * JS: NativeModules.FossQrScanner.scan(prompt) -> Promise<string | null> (null = cancelled).
 * The scanned text is returned to JS only; nothing is logged or stored.
 */
class FossQrScannerModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx), ActivityEventListener {

  private var pending: Promise? = null

  init {
    ctx.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun scan(prompt: String?, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    if (pending != null) {
      promise.reject("E_BUSY", "A scan is already in progress")
      return
    }
    val options = ScanOptions()
      .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
      .setPrompt(prompt ?: "")
      .setBeepEnabled(false)
      .setOrientationLocked(false)
    pending = promise
    try {
      activity.startActivityForResult(ScanContract().createIntent(activity, options), REQUEST_CODE)
    } catch (e: Exception) {
      pending = null
      promise.reject("E_SCAN_START", "Could not open the scanner", e)
    }
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_CODE) return
    val promise = pending ?: return
    pending = null
    val result = ScanIntentResult.parseActivityResult(resultCode, data)
    promise.resolve(result.contents)
  }

  override fun onNewIntent(intent: Intent) {}

  companion object {
    const val NAME = "FossQrScanner"
    private const val REQUEST_CODE = 0x5143
  }
}
