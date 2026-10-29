// Play builds do not install APKs from inside the app.
// REQUEST_INSTALL_PACKAGES is a restricted permission, and a wallet is
// not an app store. Phone builds are installed with adb or FlipSend.
// Store updates come from Google Play.

export async function downloadAndInstallApk(_apkUrl: string): Promise<void> {
  throw new Error(
    "Install updates from Google Play. This app does not install APK packages itself.",
  );
}
