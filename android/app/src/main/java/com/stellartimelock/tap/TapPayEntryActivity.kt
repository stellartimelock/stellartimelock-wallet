package com.stellartimelock.tap

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.stellartimelock.MainActivity
import com.stellartimelock.keys.KeyPickerGuard

/**
 * Signature-protected entry points for Market and Delivery Driver.
 * Both screens still land in the wallet, which shows the full amount
 * and recipient before any key is used.
 *
 * Public because [TapPayRequestActivity] and [TapPayPayActivity] are
 * public manifest activities. An internal supertype cannot be exposed
 * by those subclasses.
 */
abstract class TapPayEntryActivity : AppCompatActivity() {
    private var resumes = 0
    private var accepted = false

    protected abstract val expectedAction: String
    protected abstract fun accept(intent: Intent, requestId: String): String?

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.decorView.setBackgroundColor(BG)
        if (intent?.action != expectedAction) {
            deny(TapPayContract.ERROR_CALLER_NOT_ALLOWED, null)
            return
        }
        val requestId = TapPayContract.validRequestId(intent.getStringExtra(TapPayContract.EXTRA_REQUEST_ID))
        val caller = resolveCaller()
        if (caller == null || !KeyPickerGuard.isCallerAllowed(this, caller)) {
            deny(TapPayContract.ERROR_CALLER_NOT_ALLOWED, requestId)
            return
        }
        if (requestId == null) {
            deny(TapPayContract.ERROR_REQUEST_ID_REQUIRED, null)
            return
        }
        val link = accept(intent, requestId)
        if (link == null) {
            deny(TapPayContract.ERROR_INVALID_INPUT, requestId)
            return
        }
        accepted = true
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link), this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        })
    }

    override fun onResume() {
        super.onResume()
        resumes += 1
        if (accepted && resumes >= 2 && !isFinishing) {
            setContentView(waitingView())
        }
    }

    override fun onDestroy() {
        TapPaySessions.drop(this)
        super.onDestroy()
    }

    private fun resolveCaller(): String? {
        callingPackage?.let { return it }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            return referrer?.host
        }
        return null
    }

    private fun deny(code: String, requestId: String?) {
        setResult(RESULT_CANCELED, TapPayContract.errorIntent(requestId, code))
        finish()
    }

    private fun waitingView(): LinearLayout {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(BG)
            setPadding(48, 48, 48, 48)
        }
        column.addView(TextView(this).apply {
            text = "Confirm the payment in Stellar TimeLock."
            setTextColor(FG)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        })
        column.addView(Button(this).apply {
            text = "Cancel"
            setOnClickListener {
                val row = TapPaySessions.current()
                val id = row?.requestId
                setResult(RESULT_CANCELED, TapPayContract.errorIntent(id, TapPayContract.ERROR_CANCELED))
                finish()
            }
        })
        return column
    }

    private companion object {
        const val BG = 0xFF0A0E17.toInt()
        val FG: Int = Color.parseColor("#F5F7FA")
    }
}

class TapPayRequestActivity : TapPayEntryActivity() {
    override val expectedAction: String = TapPayContract.ACTION_REQUEST_PAY

    override fun accept(intent: Intent, requestId: String): String? {
        val amount = TapPayContract.validAmount(intent.getStringExtra(TapPayContract.EXTRA_AMOUNT))
            ?: return null
        val memo = TapPayContract.validMemo(intent.getStringExtra(TapPayContract.EXTRA_MEMO))
        val label = TapPayContract.validLabel(intent.getStringExtra(TapPayContract.EXTRA_LABEL))
        TapPaySessions.hold(
            TapPaySessions.Held(
                action = "REQUEST_PAY",
                requestId = requestId,
                amount = amount,
                memo = memo,
                destination = null,
                uri = null,
                label = label,
                activity = this,
            ),
        )
        return TapPayContract.requestDeepLink(requestId, amount, memo, label)
    }
}

class TapPayPayActivity : TapPayEntryActivity() {
    override val expectedAction: String = TapPayContract.ACTION_PAY

    override fun accept(intent: Intent, requestId: String): String? {
        val uri = TapPayContract.validPayUri(intent.getStringExtra(TapPayContract.EXTRA_URI))
        val destination = TapPayContract.validDestination(intent.getStringExtra(TapPayContract.EXTRA_DESTINATION))
        val amount = TapPayContract.validAmount(intent.getStringExtra(TapPayContract.EXTRA_AMOUNT))
        val memo = TapPayContract.validMemo(intent.getStringExtra(TapPayContract.EXTRA_MEMO))
        val label = TapPayContract.validLabel(intent.getStringExtra(TapPayContract.EXTRA_LABEL))
        if (uri == null && (destination == null || amount == null)) return null
        TapPaySessions.hold(
            TapPaySessions.Held(
                action = "PAY",
                requestId = requestId,
                amount = if (uri == null) amount else null,
                memo = memo,
                destination = if (uri == null) destination else null,
                uri = uri,
                label = label,
                activity = this,
            ),
        )
        return TapPayContract.payDeepLink(requestId, uri, destination, amount, memo, label)
    }
}
