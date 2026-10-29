package com.stellartimelock.updates

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Register in MainApplication.getPackages(). */
class ApkInstallerPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        if (name == ApkInstallerModule.NAME) {
            return ApkInstallerModule(reactContext)
        }
        return null
    }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
        return ReactModuleInfoProvider {
            mapOf(
                ApkInstallerModule.NAME to
                    ReactModuleInfo(
                        ApkInstallerModule.NAME,
                        ApkInstallerModule::class.java.name,
                        false,
                        false,
                        false,
                        true,
                    ),
            )
        }
    }
}
