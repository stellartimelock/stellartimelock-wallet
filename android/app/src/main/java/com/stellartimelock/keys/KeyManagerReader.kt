package com.stellartimelock.keys

import android.content.Context
import android.database.sqlite.SQLiteDatabase

/**
 * Reads the Key Manager blob the React Native app already stores.
 * AsyncStorage keeps it in RKStorage / catalystLocalStorage under
 * `xlm_vault_key_manager_v1`. The JS storage wrapper JSON-encodes the
 * string a second time; [parseKeyManagerPayload] accepts either shape.
 *
 * Nothing from this read is logged: not the row, not the seed, not
 * the failure.
 */
internal data class KeyLoad(val keys: List<ManagedKey>, val needsUnlock: Boolean)

internal object KeyManagerReader {
    private const val KEY = "xlm_vault_key_manager_v1"

    fun hasPayload(context: Context): Boolean {
        return !readPayload(context).isNullOrBlank()
    }

    /**
     * Decrypt only when [seed] is the in-RAM wallet seed, and only after
     * the caller has finished the biometric prompt. A plaintext JSON
     * array is an older save and still opens.
     */
    fun load(context: Context, seed: String?): KeyLoad {
        val raw = unwrapKeyManagerStored(readPayload(context)) ?: return KeyLoad(emptyList(), false)
        val encrypted = PortableBackupCrypto.looksEncrypted(raw)
        if (encrypted && seed.isNullOrEmpty()) return KeyLoad(emptyList(), true)
        val keys = parseKeyManagerPayload(raw, seed)
        if (encrypted && keys.isEmpty()) return KeyLoad(emptyList(), true)
        return KeyLoad(keys, false)
    }

    private fun readPayload(context: Context): String? {
        // New Architecture AsyncStorage (Room) is the live database.
        // RKStorage is the legacy file, still read if the new one is absent.
        val modern = readRow(context, "AsyncStorage", "Storage")
        if (!modern.isNullOrBlank()) return modern
        return readRow(context, "RKStorage", "catalystLocalStorage")
    }

    private fun readRow(context: Context, dbName: String, table: String): String? {
        val file = context.getDatabasePath(dbName)
        if (!file.exists()) return null
        var db: SQLiteDatabase? = null
        try {
            db = SQLiteDatabase.openDatabase(
                file.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY,
            )
            db.rawQuery(
                "SELECT value FROM $table WHERE `key` = ? LIMIT 1",
                arrayOf(KEY),
            ).use { cursor ->
                if (!cursor.moveToFirst()) return null
                return cursor.getString(0)
            }
        } catch (_: Exception) {
            return null
        } finally {
            db?.close()
        }
    }
}
