package com.stellartimelock.keys

import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Seed-derived backup crypto, matching src/security/backup-crypto.ts.
 * v3 is PBKDF2-SHA256, 100_000 rounds, random salt. v1 and v2 stay readable.
 * The key is the wallet seed. Nothing here touches the Android Keystore.
 */
internal object PortableBackupCrypto {
    private const val AES_SALT = "xlm_vault_notebook_v2_salt"
    private const val MAC_SALT = "xlm_vault_notebook_v2_mac_salt"
    private const val V1_ROUNDS = 10_000
    private const val V3_ROUNDS = 100_000

    fun looksEncrypted(raw: String): Boolean {
        val text = raw.trim()
        if (text.startsWith("[") || text.startsWith("{")) return false
        if (text.startsWith("v3.")) return true
        val parts = text.split(".")
        if (parts.size != 2 && parts.size != 3) return false
        return parts.all { part ->
            part.length >= 4 && part.all { ch ->
                ch.isLetterOrDigit() || ch == '+' || ch == '/' || ch == '='
            }
        }
    }

    fun open(payload: String, seed: String): String? {
        if (seed.isEmpty()) return null
        val parts = payload.trim().split(".")
        return try {
            when {
                parts.firstOrNull() == "v3" && parts.size == 5 -> decryptV3(parts, seed)
                parts.size == 3 -> decryptV2(parts, seed)
                parts.size == 2 -> decryptV1(parts, seed)
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun decryptV1(parts: List<String>, seed: String): String? {
        val iv = b64(parts[0])
        val ct = b64(parts[1])
        val pass = seed.toByteArray(Charsets.UTF_8)
        // SHA-256 first: that is CryptoJS 4's default, which 1.0–1.6.3 used.
        for (sha256 in listOf(true, false)) {
            val aes = pbkdf2(pass, AES_SALT.toByteArray(), V1_ROUNDS, 32, sha256)
            val plain = aesDecrypt(iv, ct, aes) ?: continue
            val first = plain.trim().firstOrNull()
            if (first == '{' || first == '[' || first == '"') return plain
        }
        return null
    }

    private fun decryptV2(parts: List<String>, seed: String): String? {
        val pass = seed.toByteArray(Charsets.UTF_8)
        val iv = b64(parts[0])
        val ct = b64(parts[1])
        val expected = b64(parts[2])
        for (sha256 in listOf(true, false)) {
            val aes = pbkdf2(pass, AES_SALT.toByteArray(), V1_ROUNDS, 32, sha256)
            val macKey = pbkdf2(pass, MAC_SALT.toByteArray(), V1_ROUNDS, 32, sha256)
            if (!macOk(iv, ct, expected, macKey)) continue
            return aesDecrypt(iv, ct, aes)
        }
        return null
    }

    private fun decryptV3(parts: List<String>, seed: String): String? {
        val salt = b64(parts[1])
        val mixed = pbkdf2(seed.toByteArray(Charsets.UTF_8), salt, V3_ROUNDS, 64, true)
        val aes = mixed.copyOfRange(0, 32)
        val macKey = mixed.copyOfRange(32, 64)
        val iv = b64(parts[2])
        val ct = b64(parts[3])
        val expected = b64(parts[4])
        if (!macOk(iv, ct, expected, macKey)) return null
        return aesDecrypt(iv, ct, aes)
    }

    private fun macOk(iv: ByteArray, ct: ByteArray, expected: ByteArray, macKey: ByteArray): Boolean {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(macKey, "HmacSHA256"))
        mac.update(iv)
        val computed = mac.doFinal(ct)
        if (computed.size != expected.size) return false
        var diff = 0
        for (i in computed.indices) diff = diff or (computed[i].toInt() xor expected[i].toInt())
        return diff == 0
    }

    private fun aesDecrypt(iv: ByteArray, ct: ByteArray, key: ByteArray): String? {
        if (iv.size != 16 || key.size != 32) return null
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        val plain = cipher.doFinal(ct)
        val text = String(plain, Charsets.UTF_8)
        if (text.isEmpty()) return null
        return text
    }

    private fun b64(value: String): ByteArray {
        val cleaned = value.trim().replace(Regex("\\s+"), "").replace('-', '+').replace('_', '/')
        return Base64.decode(cleaned, Base64.DEFAULT)
    }

    private fun pbkdf2(
        password: ByteArray,
        salt: ByteArray,
        iterations: Int,
        outLen: Int,
        sha256: Boolean,
    ): ByteArray {
        val algo = if (sha256) "HmacSHA256" else "HmacSHA1"
        val mac = Mac.getInstance(algo)
        mac.init(SecretKeySpec(password, algo))
        val hLen = mac.macLength
        val blocks = (outLen + hLen - 1) / hLen
        val out = ByteArray(blocks * hLen)
        val block = ByteArray(salt.size + 4)
        System.arraycopy(salt, 0, block, 0, salt.size)
        for (i in 1..blocks) {
            block[salt.size] = (i shr 24).toByte()
            block[salt.size + 1] = (i shr 16).toByte()
            block[salt.size + 2] = (i shr 8).toByte()
            block[salt.size + 3] = i.toByte()
            var u = mac.doFinal(block)
            val t = u.copyOf()
            for (round in 2..iterations) {
                u = mac.doFinal(u)
                for (b in t.indices) t[b] = (t[b].toInt() xor u[b].toInt()).toByte()
            }
            System.arraycopy(t, 0, out, (i - 1) * hLen, hLen)
        }
        return out.copyOf(outLen)
    }
}
