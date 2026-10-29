package com.stellartimelock.tap

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class TapPayPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        if (name == TapPayModule.NAME) return TapPayModule(reactContext)
        return null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                TapPayModule.NAME to ReactModuleInfo(
                    TapPayModule.NAME,
                    TapPayModule::class.java.name,
                    false,
                    false,
                    false,
                    true,
                ),
            )
        }
    }
}
