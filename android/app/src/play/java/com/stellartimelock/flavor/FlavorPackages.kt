package com.stellartimelock.flavor

import com.facebook.react.ReactPackage

/** Play flavor: no extra native packages (QR scanning uses expo-camera). */
object FlavorPackages {
  fun get(): List<ReactPackage> = emptyList()
}
