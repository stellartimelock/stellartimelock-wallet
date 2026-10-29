package com.stellartimelock.tap

internal object TapPayRequestStore {
    private const val MAX_URI_BYTES = 1024
    private val lock = Any()
    private var payload: ByteArray? = null

    fun setUri(uri: String?) {
        synchronized(lock) {
            if (uri.isNullOrBlank()) {
                payload = null
                return
            }
            val bytes = uri.toByteArray(Charsets.UTF_8)
            payload = if (bytes.size in 1..MAX_URI_BYTES) bytes else null
        }
    }

    fun payload(): ByteArray? = synchronized(lock) { payload?.copyOf() }
}
