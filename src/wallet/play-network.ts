// Play and other release builds stay on mainnet.
// A debug build can still switch to testnet from Request or pay.
//
// One exception: the testnet verification build used for public recovery
// checks on an emulator. It is built with EXPO_PUBLIC_STL_VERIFY_TESTNET=1,
// which Gradle turns into applicationId com.stellartimelock.verify, signed
// with the house debug key, fdroid flavor only. That build runs on testnet
// only and never touches mainnet. Play and F-Droid builds never set the flag.

export function isPlayReleaseBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === false;
}

/** True only in the testnet verification build (com.stellartimelock.verify). */
export function isVerifyTestnetBuild(): boolean {
  return process.env.EXPO_PUBLIC_STL_VERIFY_TESTNET === "1";
}
