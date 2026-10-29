package com.stellartimelock.updates

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import java.io.File

/**
 * Native installer used by src/updates/install-apk.ts (NativeModules.ApkInstaller).
 * Requires REQUEST_INSTALL_PACKAGES and the FileProvider in the app manifest.
 * The system installer verifies the APK signature against the installed app.
 *
 * Implements TurboModule so the new architecture (enabled in this app) can
 * resolve the module through BaseReactPackage.getModule.
 */
@ReactModule(name = ApkInstallerModule.NAME)
class ApkInstallerModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), TurboModule {

    override fun getName(): String = NAME

    @ReactMethod
    fun canRequestPackageInstalls(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            promise.resolve(true)
            return
        }
        promise.resolve(reactContext.packageManager.canRequestPackageInstalls())
    }

    @ReactMethod
    fun openInstallPermissionSettings(promise: Promise) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${reactContext.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        reactContext.startActivity(intent)
        promise.resolve(null)
    }

    @ReactMethod
    fun install(path: String, promise: Promise) {
        try {
            val file = File(path)
            val authority = "${reactContext.packageName}.fileprovider"
            val uri = FileProvider.getUriForFile(reactContext, authority, file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (error: Exception) {
            promise.reject("INSTALL_FAILED", error.message, error)
        }
    }

    companion object {
        const val NAME = "ApkInstaller"
    }
}
