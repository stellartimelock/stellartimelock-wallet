package com.stellartimelock.flavor

import com.facebook.react.ReactPackage

/** F-Droid flavor: FOSS QR scanner (ZXing) instead of expo-camera's ML Kit scanner. */
object FlavorPackages {
  fun get(): List<ReactPackage> = listOf(FossQrScannerPackage())
}
