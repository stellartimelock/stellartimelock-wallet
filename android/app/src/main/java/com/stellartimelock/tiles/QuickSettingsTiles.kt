package com.stellartimelock.tiles

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.stellartimelock.MainActivity
import com.stellartimelock.R

/**
 * Quick Settings actions. Each tile opens an existing wallet screen.
 * Balance does not put an amount on the tile; the wallet shows it only
 * after the biometric gate.
 */
internal fun TileService.openWallet(uri: String, requestCode: Int) {
    unlockAndRun {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
            setClass(this@openWallet, MainActivity::class.java)
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP,
            )
        }
        if (Build.VERSION.SDK_INT >= 34) {
            val pending = PendingIntent.getActivity(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}

private fun TileService.show(label: String, iconRes: Int) {
    qsTile?.apply {
        this.label = label
        this.icon = Icon.createWithResource(this@show, iconRes)
        state = Tile.STATE_INACTIVE
        updateTile()
    }
}

class ReceiveTileService : TileService() {
    override fun onStartListening() {
        show(getString(R.string.qs_receive_xlm), R.drawable.ic_qs_receive)
    }

    override fun onClick() {
        openWallet("stellartimelock://receive", 1)
    }
}

class SendTileService : TileService() {
    override fun onStartListening() {
        show(getString(R.string.qs_send_xlm), R.drawable.ic_qs_send)
    }

    override fun onClick() {
        openWallet("stellartimelock://send?favorites=1", 2)
    }
}

class BalanceTileService : TileService() {
    override fun onStartListening() {
        show(getString(R.string.qs_balance), R.drawable.ic_qs_balance)
    }

    override fun onClick() {
        val stamp = System.currentTimeMillis()
        openWallet("stellartimelock://wallet?tile=balance&t=$stamp", 3)
    }
}
