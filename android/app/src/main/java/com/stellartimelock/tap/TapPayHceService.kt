package com.stellartimelock.tap

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * Serves the current SEP-7 pay link to another phone.
 *
 * Registered in the non-payment ("other") AID group only. This service
 * must not be offered as a default payment app.
 */
class TapPayHceService : HostApduService() {
    override fun processCommandApdu(commandApdu: ByteArray?, extras: Bundle?): ByteArray {
        if (commandApdu == null) return byteArrayOf(0x6A.toByte(), 0x82.toByte())
        return TapPayApdu.process(commandApdu, TapPayRequestStore.payload())
    }

    override fun onDeactivated(reason: Int) {
        // The field dropped. The URI stays until the request screen clears it.
    }
}
