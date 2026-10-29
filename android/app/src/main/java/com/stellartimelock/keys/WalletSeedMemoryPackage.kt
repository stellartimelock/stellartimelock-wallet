package com.stellartimelock.keys

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class WalletSeedMemoryPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        if (name == WalletSeedMemoryModule.NAME) {
            return WalletSeedMemoryModule(reactContext)
        }
        return null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                WalletSeedMemoryModule.NAME to
                    ReactModuleInfo(
                        WalletSeedMemoryModule.NAME,
                        WalletSeedMemoryModule::class.java.name,
                        false,
                        false,
                        false,
                        true,
                    ),
            )
        }
    }
}
