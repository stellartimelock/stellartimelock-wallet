package com.stellartimelock.tap

import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.min

/**
 * App-to-app APDU exchange for a SEP-7 pay link.
 *
 * This is not an EMV dialog. There is no PPSE, no payment AID, and no
 * cryptogram. The payer selects a proprietary AID and then reads the
 * URI in short chunks.
 *
 * AID: F053544C50415901 (proprietary, not a card-network RID).
 * GET INFO  80 10 00 00 00  -> version, length (uint16), 9000
 * READ      80 11 offHi offLo Le -> bytes, 9000
 */
internal object TapPayApdu {
    const val AID_HEX = "F053544C50415901"
    val AID: ByteArray = hex(AID_HEX)
    private const val MAX_URI_BYTES = 1024
    const val CHUNK = 200

    fun process(command: ByteArray, payload: ByteArray?): ByteArray {
        if (command.size < 2) return sw(0x67, 0x00)
        if (isSelect(command)) {
            if (payload == null || payload.isEmpty() || payload.size > MAX_URI_BYTES) {
                return sw(0x6A, 0x82)
            }
            return sw(0x90, 0x00)
        }
        if (payload == null || payload.isEmpty()) return sw(0x6A, 0x82)
        val cla = command[0]
        val ins = command[1]
        if (cla != 0x80.toByte()) return sw(0x6E, 0x00)
        if (ins == 0x10.toByte()) {
            if (command.size < 4) return sw(0x67, 0x00)
            val body = byteArrayOf(
                0x01,
                (payload.size shr 8).toByte(),
                (payload.size and 0xFF).toByte(),
            )
            return ok(body)
        }
        if (ins == 0x11.toByte()) {
            if (command.size != 5) return sw(0x67, 0x00)
            val offset = ((command[2].toInt() and 0xFF) shl 8) or (command[3].toInt() and 0xFF)
            if (offset > payload.size) return sw(0x6B, 0x00)
            var le = command[4].toInt() and 0xFF
            if (le == 0) le = 256
            val count = min(le, payload.size - offset)
            val slice = payload.copyOfRange(offset, offset + count)
            return ok(slice)
        }
        return sw(0x6D, 0x00)
    }

    fun selectApdu(): ByteArray {
        val apdu = ByteArray(6 + AID.size)
        apdu[0] = 0x00
        apdu[1] = 0xA4.toByte()
        apdu[2] = 0x04
        apdu[3] = 0x00
        apdu[4] = AID.size.toByte()
        AID.copyInto(apdu, 5)
        apdu[apdu.size - 1] = 0x00
        return apdu
    }

    fun readUri(iso: android.nfc.tech.IsoDep): String {
        val selected = iso.transceive(selectApdu())
        if (!statusOk(selected)) error("select")
        val info = iso.transceive(byteArrayOf(0x80.toByte(), 0x10, 0x00, 0x00, 0x00))
        if (!statusOk(info) || info.size < 5 || info[0] != 0x01.toByte()) error("info")
        val length = ((info[1].toInt() and 0xFF) shl 8) or (info[2].toInt() and 0xFF)
        if (length <= 0 || length > MAX_URI_BYTES) error("length")
        val out = ByteArrayOutputStream(length)
        var offset = 0
        while (offset < length) {
            val le = min(CHUNK, length - offset)
            val apdu = byteArrayOf(
                0x80.toByte(),
                0x11,
                (offset shr 8).toByte(),
                (offset and 0xFF).toByte(),
                le.toByte(),
            )
            val chunk = iso.transceive(apdu)
            if (!statusOk(chunk) || chunk.size < 3) error("read")
            val dataLen = chunk.size - 2
            if (dataLen <= 0) error("empty")
            out.write(chunk, 0, dataLen)
            offset += dataLen
        }
        if (offset != length) error("truncated")
        return out.toByteArray().toString(Charsets.UTF_8)
    }

    private fun isSelect(command: ByteArray): Boolean {
        if (command.size < 6) return false
        if (command[0] != 0x00.toByte() || command[1] != 0xA4.toByte()) return false
        if (command[2] != 0x04.toByte() || command[3] != 0x00.toByte()) return false
        val lc = command[4].toInt() and 0xFF
        if (lc != AID.size || command.size < 5 + lc) return false
        return command.copyOfRange(5, 5 + lc).contentEquals(AID)
    }

    private fun ok(data: ByteArray): ByteArray {
        val out = ByteArray(data.size + 2)
        if (data.isNotEmpty()) data.copyInto(out)
        out[out.size - 2] = 0x90.toByte()
        out[out.size - 1] = 0x00
        return out
    }

    private fun sw(a: Int, b: Int): ByteArray = byteArrayOf(a.toByte(), b.toByte())

    private fun statusOk(response: ByteArray): Boolean {
        if (response.size < 2) return false
        val sw1 = response[response.size - 2].toInt() and 0xFF
        val sw2 = response[response.size - 1].toInt() and 0xFF
        return sw1 == 0x90 && sw2 == 0x00
    }

    private fun hex(value: String): ByteArray {
        val clean = value.lowercase(Locale.US)
        val out = ByteArray(clean.length / 2)
        var i = 0
        while (i < clean.length) {
            out[i / 2] = clean.substring(i, i + 2).toInt(16).toByte()
            i += 2
        }
        return out
    }
}
