package com.stellartimelock.keys

/**
 * In-RAM wallet seed for PICK_KEY. The React Native session publishes
 * it after the seed is typed or rebuilt from the derived signing key.
 * Nothing in this object is written to disk or to the Android Keystore.
 */
internal object WalletSeedMemory {
    private var seed: CharArray? = null

    fun publish(value: String) {
        clear()
        if (value.isEmpty()) return
        seed = value.toCharArray()
    }

    fun clear() {
        seed?.fill('\u0000')
        seed = null
    }

    fun copySeed(): String? {
        val current = seed ?: return null
        return String(current)
    }
}
