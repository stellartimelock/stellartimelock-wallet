// Play and other release builds stay on mainnet.
// A debug build can still switch to testnet from Request or pay.

export function isPlayReleaseBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === false;
}
