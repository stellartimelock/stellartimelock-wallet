# F-Droid flavor: these proprietary libraries are excluded from the build on purpose.
# Expo modules still reference them in code paths the app never calls
# (push tokens, ML Kit barcode analysis, install referrer).
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**
-dontwarn com.google.android.datatransport.**
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.odml.**
-dontwarn com.android.installreferrer.**
-dontwarn androidx.camera.mlkit.**
