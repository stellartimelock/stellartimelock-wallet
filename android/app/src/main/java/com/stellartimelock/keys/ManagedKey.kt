package com.stellartimelock.keys

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * One Key Manager row. The secret is a char array so it can be wiped.
 * Nothing in this type is safe to log.
 */
internal class ManagedKey(
    val id: String,
    val label: String,
    val publicAddress: String,
    val secret: CharArray,
) {
    fun wipe() {
        secret.fill('\u0000')
    }
}

internal fun parseKeyManagerPayload(stored: String?, seed: String?): List<ManagedKey> {
    val unwrapped = unwrapKeyManagerStored(stored) ?: return emptyList()
    val json = if (PortableBackupCrypto.looksEncrypted(unwrapped)) {
        if (seed.isNullOrEmpty()) return emptyList()
        PortableBackupCrypto.open(unwrapped, seed) ?: return emptyList()
    } else {
        unwrapped
    }
    val array = decodeArray(json) ?: return emptyList()
    val out = ArrayList<ManagedKey>(array.length())
    for (i in 0 until array.length()) {
        val obj = array.optJSONObject(i) ?: continue
        val id = obj.optString("id", "").trim()
        val secret = obj.optString("secretSeed", "").trim()
        if (id.isEmpty() || !isStellarSecret(secret)) continue
        val label = obj.optString("label", "").trim().ifEmpty { "Key" }
        val address = obj.optString("publicAddress", "").trim()
        out.add(ManagedKey(id, label, address, secret.toCharArray()))
    }
    return out
}

private fun isStellarSecret(secret: String): Boolean {
    if (secret.length != 56 || secret[0] != 'S') return false
    for (ch in secret) {
        val ok = ch in 'A'..'Z' || ch in '2'..'7'
        if (!ok) return false
    }
    return true
}

internal fun unwrapKeyManagerStored(stored: String?): String? {
    if (stored.isNullOrBlank()) return null
    var text = stored.trim()
    repeat(2) {
        if (!text.startsWith("\"")) return@repeat
        try {
            val parsed = JSONTokener(text).nextValue()
            if (parsed is String) text = parsed.trim()
        } catch (_: JSONException) {
            return text
        }
    }
    return text
}

private fun decodeArray(stored: String): JSONArray? {
    return try {
        when (val value = JSONTokener(stored.trim()).nextValue()) {
            is JSONArray -> value
            is String -> {
                when (val inner = JSONTokener(value).nextValue()) {
                    is JSONArray -> inner
                    else -> null
                }
            }
            is JSONObject -> null
            else -> null
        }
    } catch (_: JSONException) {
        null
    }
}
