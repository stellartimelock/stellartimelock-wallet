# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:
-keep class com.stellartimelock.wallet.IKeyPicker { *; }
-keep class com.stellartimelock.wallet.IKeyPicker$Stub { *; }
-keep class com.stellartimelock.wallet.IKeyPickerCallback { *; }
-keep class com.stellartimelock.wallet.IKeyPickerCallback$Stub { *; }
-keep class com.stellartimelock.keys.** { *; }
-keep class com.stellartimelock.contacts.** { *; }
-keep class com.stellartimelock.tiles.** { *; }
-keep class com.stellartimelock.tap.** { *; }

# Expo release minify. Library AARs ship their own rules; these cover the host.
-keepclassmembers public class com.facebook.react.ReactActivityDelegate {
  public *;
  protected *;
  private com.facebook.react.ReactDelegate mReactDelegate;
}
-keepclassmembers public class expo.modules.ReactActivityDelegateWrapper {
  protected com.facebook.react.ReactDelegate getReactDelegate();
}
-keepclassmembers public class com.facebook.react.ReactActivity {
  private final com.facebook.react.ReactActivityDelegate mDelegate;
}
-keepclassmembers public class com.facebook.react.ReactNativeHost {
  protected *;
}
-keepclassmembers public class expo.modules.ExpoModulesPackageList {
  public *;
}
-keepnames class * extends expo.modules.core.BasePackage
-keepnames class * implements expo.modules.core.interfaces.Package
-keep class com.facebook.react.views.view.WindowUtilKt { *; }
-keep class com.squareup.zstd.** { *; }
-keep class com.stellartimelock.keys.PortableBackupCrypto { *; }
-keep class com.stellartimelock.keys.WalletSeedMemoryModule { *; }
