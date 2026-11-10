import { SCOPULY_ANDROID_PACKAGE } from "./features";

/**
 * Android intent URI that launches Scopuly's launcher activity by package.
 * There is no documented Scopuly deep link that just accepts a public
 * address, so this is a package launch only (not web+stellar:pay).
 */
export function scopulyLaunchIntentUri(
  packageId: string = SCOPULY_ANDROID_PACKAGE,
): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageId)) {
    throw new Error("Invalid Android package id");
  }
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${packageId};end`;
}
