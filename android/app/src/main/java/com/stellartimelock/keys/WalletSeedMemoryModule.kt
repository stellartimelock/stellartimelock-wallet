package com.stellartimelock.keys

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule

/** Publishes the in-RAM wallet seed. The value is not logged. */
@ReactModule(name = WalletSeedMemoryModule.NAME)
class WalletSeedMemoryModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), TurboModule {

    override fun getName(): String = NAME

    @ReactMethod
    fun publish(seed: String) {
        WalletSeedMemory.publish(seed ?: "")
    }

    @ReactMethod
    fun clear() {
        WalletSeedMemory.clear()
    }

    companion object {
        const val NAME = "WalletSeedMemory"
    }
}
