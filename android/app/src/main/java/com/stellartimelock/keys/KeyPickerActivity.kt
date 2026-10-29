package com.stellartimelock.keys

import android.app.Activity
import android.content.Intent
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.RemoteException
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import com.stellartimelock.keys.KeyPickerContract.ACTION_PICK_KEY
import com.stellartimelock.keys.KeyPickerContract.ERROR_BIOMETRIC_FAILED
import com.stellartimelock.keys.KeyPickerContract.ERROR_BIOMETRIC_UNAVAILABLE
import com.stellartimelock.keys.KeyPickerContract.ERROR_CALLER_NOT_ALLOWED
import com.stellartimelock.keys.KeyPickerContract.ERROR_CANCELED
import com.stellartimelock.keys.KeyPickerContract.ERROR_NO_KEYS
import com.stellartimelock.keys.KeyPickerContract.ERROR_REQUEST_ID_REQUIRED
import com.stellartimelock.keys.KeyPickerContract.EXTRA_ERROR
import com.stellartimelock.keys.KeyPickerContract.EXTRA_KEY_ID
import com.stellartimelock.keys.KeyPickerContract.EXTRA_LABEL
import com.stellartimelock.keys.KeyPickerContract.EXTRA_REQUEST_ID
import com.stellartimelock.keys.KeyPickerContract.EXTRA_SECRET
import com.stellartimelock.keys.KeyPickerContract.EXTRA_SESSION
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Exported confirm screen for [ACTION_PICK_KEY]. Shows the requesting
 * app's name and icon, then a Class 3 biometric prompt. Device PIN,
 * pattern, and password are not accepted. The chosen seed is returned
 * only through the activity result or the in-process service callback.
 * It is never logged, copied to the clipboard, placed in a URL, or written
 * to disk.
 */
class KeyPickerActivity : AppCompatActivity() {
    private val closed = AtomicBoolean(false)
    private val authStarted = AtomicBoolean(false)
    private val io = Executors.newSingleThreadExecutor()
    private var requestId: String = ""
    private var session: IBinder? = null
    private var callerIdentity: CallerIdentity? = null
    private var choices: List<KeyChoice> = emptyList()
    private var selectedId: String? = null
    private var keys: MutableList<ManagedKey> = mutableListOf()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        window.decorView.setBackgroundColor(BG)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    finishCanceled(ERROR_CANCELED)
                }
            },
        )

        if (intent?.action != ACTION_PICK_KEY) {
            finishCanceled(ERROR_CALLER_NOT_ALLOWED)
            return
        }

        val callerPackage = resolveRequestingPackage() ?: return
        callerIdentity = identityFor(callerPackage)
        setContentView(messageView("Checking for a saved key…"))
        loadChoices()
    }

    override fun onDestroy() {
        if (closed.compareAndSet(false, true)) {
            cancelSession(ERROR_CANCELED)
            wipeKeys()
        } else {
            wipeKeys()
        }
        io.shutdownNow()
        super.onDestroy()
    }

    /**
     * @return the requesting package, or null when this activity has
     * already finished because the caller is not allowed.
     */
    private fun resolveRequestingPackage(): String? {
        val handle = sessionHandle()
        if (handle != null) {
            val pending = KeyPickerSessions.peek(handle)
            if (pending == null || !launchedByUs() ||
                !KeyPickerGuard.isCallerAllowed(this, pending.callerPackage)
            ) {
                finishCanceled(ERROR_CALLER_NOT_ALLOWED)
                return null
            }
            session = handle
            requestId = pending.requestId
            return pending.callerPackage
        }

        val caller = resolveCallerPackage()
        if (caller == null || !KeyPickerGuard.isCallerAllowed(this, caller)) {
            finishCanceled(ERROR_CALLER_NOT_ALLOWED)
            return null
        }
        requestId = intent?.getStringExtra(EXTRA_REQUEST_ID)?.trim().orEmpty()
        if (requestId.isEmpty()) {
            finishCanceled(ERROR_REQUEST_ID_REQUIRED)
            return null
        }
        return caller
    }

    private fun loadChoices() {
        try {
            io.execute {
                val present = try {
                    KeyManagerReader.hasPayload(applicationContext)
                } catch (_: Exception) {
                    false
                }
                runOnUiThread {
                    if (closed.get()) return@runOnUiThread
                    val handle = session
                    if (handle != null && KeyPickerSessions.peek(handle) == null) {
                        finishCanceled(ERROR_CANCELED)
                        return@runOnUiThread
                    }
                    if (!present) showEmpty() else showConfirm()
                }
            }
        } catch (_: Exception) {
            finishCanceled(ERROR_NO_KEYS)
        }
    }

    private fun showEmpty() {
        val root = column()
        addCallerHeader(root)
        root.addView(title("No seed saved"))
        root.addView(
            body("Key Manager has no secret seeds on this device. Add one in Stellar TimeLock, then try again."),
        )
        root.addView(button("Close") { finishCanceled(ERROR_NO_KEYS) })
        setContentView(scroll(root))
    }

    private fun showConfirm() {
        val root = column()
        addCallerHeader(root)
        root.addView(
            body("Confirm with your fingerprint. A device PIN is not accepted. The secret is not shown, logged, or saved."),
        )
        root.addView(button("Allow") { startConfirm() })
        root.addView(button("Cancel") { finishCanceled(ERROR_CANCELED) })
        setContentView(scroll(root))
    }

    private fun startConfirm() {
        if (closed.get() || callerIdentity == null) return
        if (!authStarted.compareAndSet(false, true)) return
        showBiometric()
    }

    private fun showBiometric() {
        val strong = BiometricManager.Authenticators.BIOMETRIC_STRONG
        if (BiometricManager.from(this).canAuthenticate(strong) != BiometricManager.BIOMETRIC_SUCCESS) {
            finishCanceled(ERROR_BIOMETRIC_UNAVAILABLE)
            return
        }
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    deliverSelected()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val reason = when (errorCode) {
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_CANCELED,
                        -> ERROR_CANCELED
                        BiometricPrompt.ERROR_HW_NOT_PRESENT,
                        BiometricPrompt.ERROR_HW_UNAVAILABLE,
                        BiometricPrompt.ERROR_NO_BIOMETRICS,
                        -> ERROR_BIOMETRIC_UNAVAILABLE
                        else -> ERROR_BIOMETRIC_FAILED
                    }
                    finishCanceled(reason)
                }
            },
        )
        val name = callerIdentity?.name ?: "This app"
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Confirm it is you")
            .setSubtitle(seedShareMessage(name))
            .setAllowedAuthenticators(strong)
            .setNegativeButtonText("Cancel")
            .build()
        try {
            prompt.authenticate(info)
        } catch (_: Exception) {
            finishCanceled(ERROR_BIOMETRIC_FAILED)
        }
    }

    private fun deliverSelected() {
        if (closed.get()) return
        setContentView(messageView("Confirming it is you…"))
        try {
            io.execute {
                val seed = WalletSeedMemory.copySeed()
                val loaded = try {
                    KeyManagerReader.load(applicationContext, seed)
                } catch (_: Exception) {
                    KeyLoad(emptyList(), false)
                }
                runOnUiThread {
                    if (closed.get()) {
                        loaded.keys.forEach { it.wipe() }
                        return@runOnUiThread
                    }
                    val handle = session
                    if (handle != null && KeyPickerSessions.peek(handle) == null) {
                        loaded.keys.forEach { it.wipe() }
                        finishCanceled(ERROR_CANCELED)
                        return@runOnUiThread
                    }
                    if (loaded.needsUnlock) {
                        loaded.keys.forEach { it.wipe() }
                        showNeedsUnlock()
                        return@runOnUiThread
                    }
                    keys = loaded.keys.toMutableList()
                    if (keys.isEmpty()) {
                        showEmpty()
                        return@runOnUiThread
                    }
                    if (keys.size == 1) {
                        selectedId = keys[0].id
                        deliver(keys[0].id)
                        return@runOnUiThread
                    }
                    choices = keys.map { KeyChoice(it.id, it.label, it.publicAddress) }
                    selectedId = choices.first().id
                    showChooser()
                }
            }
        } catch (_: Exception) {
            finishCanceled(ERROR_CANCELED)
        }
    }

    private fun showNeedsUnlock() {
        val root = column()
        addCallerHeader(root)
        root.addView(title("Unlock Stellar TimeLock"))
        root.addView(
            body("Open Stellar TimeLock and unlock with your fingerprint. The saved keys stay encrypted with your wallet seed."),
        )
        root.addView(button("Close") { finishCanceled(ERROR_NO_KEYS) })
        setContentView(scroll(root))
    }

    private fun showChooser() {
        val root = column()
        addCallerHeader(root)
        root.addView(body("Choose which seed to share."))
        for (choice in choices) {
            root.addView(choiceRow(choice))
        }
        root.addView(button("Allow") {
            val id = selectedId
            if (id == null) finishCanceled(ERROR_NO_KEYS) else deliver(id)
        })
        root.addView(button("Cancel") { finishCanceled(ERROR_CANCELED) })
        setContentView(scroll(root))
    }

    private fun deliver(id: String) {
        if (closed.get()) return
        val entry = keys.firstOrNull { it.id == id } ?: return
        val handle = session
        val pending = if (handle != null) KeyPickerSessions.take(handle) else null
        if (handle != null && pending == null) {
            finishCanceled(ERROR_CANCELED)
            return
        }
        if (!closed.compareAndSet(false, true)) {
            if (handle != null && pending != null) KeyPickerSessions.restore(handle, pending)
            return
        }
        val secret = String(entry.secret)
        try {
            if (pending != null) {
                try {
                    pending.callback.onPicked(pending.requestId, entry.id, entry.label, secret)
                } catch (_: RemoteException) {
                    // Caller is gone. Do not log the secret.
                }
                setResult(Activity.RESULT_CANCELED)
            } else {
                val data = Intent().apply {
                    putExtra(EXTRA_REQUEST_ID, requestId)
                    putExtra(EXTRA_KEY_ID, entry.id)
                    putExtra(EXTRA_LABEL, entry.label)
                    putExtra(EXTRA_SECRET, secret)
                }
                setResult(Activity.RESULT_OK, data)
            }
            finish()
        } finally {
            wipeKeys()
        }
    }

    private fun finishCanceled(reason: String) {
        if (!closed.compareAndSet(false, true)) return
        cancelSession(reason)
        wipeKeys()
        val data = Intent().apply {
            putExtra(EXTRA_ERROR, reason)
            if (requestId.isNotEmpty()) putExtra(EXTRA_REQUEST_ID, requestId)
        }
        setResult(Activity.RESULT_CANCELED, data)
        finish()
    }

    private fun cancelSession(reason: String) {
        val handle = session ?: return
        val pending = KeyPickerSessions.cancel(handle) ?: return
        try {
            pending.callback.onCanceled(pending.requestId, reason)
        } catch (_: RemoteException) {
            // Caller is gone.
        }
    }

    private fun wipeKeys() {
        keys.forEach { it.wipe() }
        keys.clear()
    }

    private fun sessionHandle(): IBinder? = intent?.extras?.getBinder(EXTRA_SESSION)

    private fun launchedByUs(): Boolean {
        val caller = resolveCallerPackage()
        return caller == null || caller == packageName
    }

    private fun resolveCallerPackage(): String? {
        callingPackage?.let { return it }
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                launchedFromPackage?.let { return it }
            } catch (_: SecurityException) {
                return null
            }
        }
        return callingActivity?.packageName
    }

    private fun identityFor(packageName: String): CallerIdentity {
        val pm = packageManager
        return try {
            val info = pm.getApplicationInfo(packageName, 0)
            val raw = pm.getApplicationLabel(info)?.toString().orEmpty()
            val name = raw.replace(Regex("\\s+"), " ").trim().ifEmpty { packageName }
            CallerIdentity(name, pm.getApplicationIcon(info))
        } catch (_: Exception) {
            CallerIdentity(packageName.ifBlank { "This app" }, pm.defaultActivityIcon)
        }
    }

    private fun addCallerHeader(root: LinearLayout) {
        val identity = callerIdentity ?: return
        root.addView(iconView(identity.icon, identity.name))
        root.addView(title(seedShareMessage(identity.name)))
    }

    private fun iconView(drawable: Drawable, label: String): ImageView {
        val size = dp(72)
        return ImageView(this).apply {
            setImageDrawable(drawable)
            contentDescription = label
            scaleType = ImageView.ScaleType.FIT_CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            layoutParams = LinearLayout.LayoutParams(size, size).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(16)
            }
        }
    }

    private fun choiceRow(choice: KeyChoice): TextView {
        val selected = choice.id == selectedId
        return TextView(this).apply {
            text = "${choice.label}\n${shorten(choice.publicAddress)}"
            setTextColor(if (selected) ACCENT else TEXT)
            textSize = 16f
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(if (selected) SELECTED else SURFACE)
            isClickable = true
            isFocusable = true
            contentDescription = choice.label
            setOnClickListener {
                if (closed.get()) return@setOnClickListener
                selectedId = choice.id
                if (authStarted.get()) showChooser() else showConfirm()
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dp(8) }
        }
    }

    private fun messageView(text: String): View {
        val root = column()
        addCallerHeader(root)
        root.addView(body(text))
        return scroll(root)
    }

    private fun scroll(child: View): ScrollView {
        return ScrollView(this).apply {
            setBackgroundColor(BG)
            addView(child)
        }
    }

    private fun column(): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
            setBackgroundColor(BG)
        }
    }

    private fun title(text: String): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(TEXT)
            textSize = 22f
            setPadding(0, 0, 0, dp(8))
        }
    }

    private fun body(text: String): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(MUTED)
            textSize = 15f
            setPadding(0, 0, 0, dp(18))
        }
    }

    private fun button(text: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(ACCENT)
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(14), dp(16), dp(14))
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
        }
    }

    private fun shorten(address: String): String {
        if (address.length < 12) return if (address.isBlank()) "No public address" else address
        return address.take(4) + "…" + address.takeLast(4)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private data class CallerIdentity(val name: String, val icon: Drawable)

    private data class KeyChoice(
        val id: String,
        val label: String,
        val publicAddress: String,
    )

    companion object {
        private const val BG = 0xFF060812.toInt()
        private const val SURFACE = 0xFF111827.toInt()
        private const val SELECTED = 0xFF1A2A44.toInt()
        private const val TEXT = 0xFFF5F7FA.toInt()
        private const val MUTED = 0xFF8A93A6.toInt()
        private const val ACCENT = 0xFF5E9FFF.toInt()
    }
}
