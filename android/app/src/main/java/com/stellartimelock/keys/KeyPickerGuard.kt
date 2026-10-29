package com.stellartimelock.keys

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import java.security.MessageDigest

/**
 * The signature permission is the gate. Any package signed by the same
 * certificate as this app may ask for a seed, including sibling apps that
 * are not named here. A caller signed by a different certificate is
 * rejected.
 */
internal object KeyPickerGuard {
    fun isUidAllowed(context: Context, uid: Int): Boolean =
        signedPackagesForUid(context, uid) != null

    /**
     * Package to name on the confirm screen for a binder caller.
     * Prefers a sibling over this app when a uid contains both.
     */
    fun callerPackageForUid(context: Context, uid: Int): String? {
        val packages = signedPackagesForUid(context, uid) ?: return null
        return packages.firstOrNull { it != context.packageName } ?: packages.first()
    }

    fun isCallerAllowed(context: Context, packageName: String?): Boolean {
        if (packageName.isNullOrBlank()) return false
        val mine = signerFingerprints(context, context.packageName)
        val theirs = signerFingerprints(context, packageName)
        return mine.isNotEmpty() && mine == theirs
    }

    private fun signedPackagesForUid(context: Context, uid: Int): List<String>? {
        val packages = try {
            context.packageManager.getPackagesForUid(uid)
        } catch (_: Exception) {
            null
        } ?: return null
        if (packages.isEmpty()) return null
        val mine = signerFingerprints(context, context.packageName)
        if (mine.isEmpty()) return null
        for (pkg in packages) {
            if (signerFingerprints(context, pkg) != mine) return null
        }
        return packages.toList()
    }

    private fun signerFingerprints(context: Context, packageName: String): Set<String> {
        return try {
            val pm = context.packageManager
            val sigs: Array<out Signature> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                info.signingInfo?.apkContentsSigners ?: emptyArray()
            } else {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
                @Suppress("DEPRECATION")
                info.signatures ?: emptyArray()
            }
            sigs.map { sha256(it.toByteArray()) }.toSet()
        } catch (_: Exception) {
            emptySet()
        }
    }

    private fun sha256(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        val out = StringBuilder(digest.size * 2)
        for (b in digest) {
            out.append(String.format("%02x", b))
        }
        return out.toString()
    }
}
