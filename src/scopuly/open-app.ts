import { Linking, Platform } from "react-native";

import { SCOPULY_PLAY_MARKET, SCOPULY_PLAY_URL } from "./features";
import { scopulyLaunchIntentUri } from "./launch-intent";

export { scopulyLaunchIntentUri } from "./launch-intent";

async function openPlayListing(): Promise<void> {
  try {
    await Linking.openURL(SCOPULY_PLAY_MARKET);
  } catch {
    await Linking.openURL(SCOPULY_PLAY_URL);
  }
}

/** Launch the Scopuly app, or its Play listing if it is not installed. */
export async function openScopulyApp(): Promise<"app" | "play"> {
  if (Platform.OS === "android") {
    try {
      await Linking.openURL(scopulyLaunchIntentUri());
      return "app";
    } catch {
      // Not installed, or the package intent could not be resolved.
    }
  }
  await openPlayListing();
  return "play";
}
