package com.stellartimelock.keys

import android.os.IBinder
import com.stellartimelock.wallet.IKeyPickerCallback
import java.util.concurrent.ConcurrentHashMap

/**
 * In-process sessions for the bound-service path. The handle is a Binder
 * this process created. Callers outside the process cannot forge it.
 * Secrets are never stored here.
 */
internal object KeyPickerSessions {
    class Pending(
        val requestId: String,
        val callback: IKeyPickerCallback,
        val callerPackage: String,
    )

    private val sessions = ConcurrentHashMap<IBinder, Pending>()

    fun register(requestId: String, callback: IKeyPickerCallback, callerPackage: String): IBinder {
        val handle = android.os.Binder()
        sessions[handle] = Pending(requestId, callback, callerPackage)
        return handle
    }

    fun peek(handle: IBinder): Pending? = sessions[handle]

    fun restore(handle: IBinder, pending: Pending) {
        sessions.putIfAbsent(handle, pending)
    }

    fun take(handle: IBinder): Pending? = sessions.remove(handle)

    fun cancel(handle: IBinder): Pending? = sessions.remove(handle)
}
