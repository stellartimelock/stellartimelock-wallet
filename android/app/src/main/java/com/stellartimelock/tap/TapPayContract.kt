package com.stellartimelock.tap

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

internal object TapPayContract {
    const val ACTION_REQUEST_PAY = "com.stellartimelock.timelock.REQUEST_PAY"
    const val ACTION_PAY = "com.stellartimelock.timelock.PAY"
    const val PERMISSION = "com.stellartimelock.timelock.permission.TAP_PAY"

    const val EXTRA_REQUEST_ID = "requestId"
    const val EXTRA_AMOUNT = "amount"
    const val EXTRA_MEMO = "memo"
    const val EXTRA_DESTINATION = "destination"
    const val EXTRA_URI = "uri"
    const val EXTRA_LABEL = "label"
    const val EXTRA_HASH = "hash"
    const val EXTRA_PAYER = "payer"
    const val EXTRA_ERROR = "error"

    const val ERROR_CALLER_NOT_ALLOWED = "caller_not_allowed"
    const val ERROR_REQUEST_ID_REQUIRED = "request_id_required"
    const val ERROR_INVALID_INPUT = "invalid_input"
    const val ERROR_CANCELED = "canceled"

    private val AMOUNT = Regex("""^(?:0|[1-9]\d{0,12})(?:\.\d{1,7})?$""")
    private val ADDRESS = Regex("""^G[A-Z2-7]{55}$""")

    fun validRequestId(raw: String?): String? {
        val text = raw?.trim() ?: return null
        if (text.isEmpty() || text.length > 80) return null
        if (text.any { it.code < 0x20 || it == '\u007f' }) return null
        return text
    }

    fun validAmount(raw: String?): String? {
        val text = raw?.trim() ?: return null
        if (!AMOUNT.matches(text)) return null
        return try {
            val value = java.math.BigDecimal(text)
            if (value.signum() <= 0) null else text
        } catch (_: Exception) {
            null
        }
    }

    fun validDestination(raw: String?): String? {
        val text = raw?.trim() ?: return null
        return if (ADDRESS.matches(text)) text else null
    }

    fun validMemo(raw: String?): String {
        val text = raw?.trim() ?: return ""
        if (text.length > 80) return ""
        if (text.any { it.code < 0x20 || it == '\u007f' }) return ""
        return text
    }

    fun validLabel(raw: String?): String {
        val text = raw?.trim() ?: return ""
        if (text.length > 80) return ""
        return text.replace(Regex("\\s+"), " ")
    }

    fun validPayUri(raw: String?): String? {
        val text = raw?.trim() ?: return null
        if (text.length > 1500) return null
        if (!text.startsWith("web+stellar:", ignoreCase = true)) return null
        return text
    }

    fun errorIntent(requestId: String?, code: String): Intent {
        return Intent().apply {
            if (!requestId.isNullOrEmpty()) putExtra(EXTRA_REQUEST_ID, requestId)
            putExtra(EXTRA_ERROR, code)
        }
    }

    fun requestDeepLink(requestId: String, amount: String, memo: String, label: String): String {
        val builder = Uri.Builder()
            .scheme("stellartimelock")
            .authority("tap-pay")
            .appendPath("request")
            .appendQueryParameter(EXTRA_REQUEST_ID, requestId)
            .appendQueryParameter(EXTRA_AMOUNT, amount)
        if (memo.isNotEmpty()) builder.appendQueryParameter(EXTRA_MEMO, memo)
        if (label.isNotEmpty()) builder.appendQueryParameter(EXTRA_LABEL, label)
        return builder.build().toString()
    }

    fun payDeepLink(
        requestId: String,
        uri: String?,
        destination: String?,
        amount: String?,
        memo: String,
        label: String,
    ): String {
        val builder = Uri.Builder()
            .scheme("stellartimelock")
            .authority("tap-pay")
            .appendPath("pay")
            .appendQueryParameter(EXTRA_REQUEST_ID, requestId)
        if (!uri.isNullOrEmpty()) {
            builder.appendQueryParameter(EXTRA_URI, uri)
        } else {
            builder.appendQueryParameter(EXTRA_DESTINATION, destination)
            builder.appendQueryParameter(EXTRA_AMOUNT, amount)
            if (memo.isNotEmpty()) builder.appendQueryParameter(EXTRA_MEMO, memo)
        }
        if (label.isNotEmpty()) builder.appendQueryParameter(EXTRA_LABEL, label)
        return builder.build().toString()
    }
}

internal object TapPaySessions {
    data class Held(
        val action: String,
        val requestId: String,
        val amount: String?,
        val memo: String?,
        val destination: String?,
        val uri: String?,
        val label: String?,
        val activity: Activity,
    )

    private val lock = Any()
    private var held: Held? = null

    fun hold(row: Held) {
        val previous = synchronized(lock) {
            val old = held
            held = row
            old
        }
        if (previous != null && previous.activity !== row.activity) {
            cancel(previous, TapPayContract.ERROR_CANCELED)
        }
    }

    fun current(): Held? = synchronized(lock) { held }

    fun drop(activity: Activity) {
        synchronized(lock) {
            if (held?.activity === activity) held = null
        }
    }

    fun finish(requestId: String, ok: Boolean, extras: Bundle): Boolean {
        val activity = synchronized(lock) {
            val row = held ?: return false
            if (row.requestId != requestId) return false
            held = null
            row.activity
        }
        activity.runOnUiThread {
            val data = Intent()
            for (key in extras.keySet()) {
                val value = extras.getString(key) ?: continue
                data.putExtra(key, value)
            }
            activity.setResult(if (ok) Activity.RESULT_OK else Activity.RESULT_CANCELED, data)
            if (!activity.isFinishing) activity.finish()
        }
        return true
    }

    private fun cancel(row: Held, code: String) {
        row.activity.runOnUiThread {
            row.activity.setResult(
                Activity.RESULT_CANCELED,
                TapPayContract.errorIntent(row.requestId, code),
            )
            if (!row.activity.isFinishing) row.activity.finish()
        }
    }
}

internal object TapPayLinks {
    fun rewrite(intent: Intent?) {
        val data = intent?.data ?: return
        val scheme = data.scheme ?: return
        if (!scheme.equals("web+stellar", ignoreCase = true)) return
        val encoded = Uri.encode(data.toString())
        intent.action = Intent.ACTION_VIEW
        intent.data = Uri.parse("stellartimelock://tap-pay/pay?uri=$encoded")
    }
}
