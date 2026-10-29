// Cross-platform URL opener for external checkout / OAuth flows.
//
// PLATFORM BEHAVIOR
// -----------------
// WEB (Metro dev + Emergent preview iframe):
//   * `Linking.openURL` internally does `window.open(url, "_blank")`,
//     which several browser/iframe combos (including the Emergent
//     preview iframe) intercept and offer as a file download instead
//     of rendering the target page.
//   * Fix: top-level `window.location.href = url` — a same-tab
//     navigation the browser cannot mistake for a download.
//
// ANDROID (native):
//   * `Linking.openURL` used to work but on newer devices (Android
//     14+, some vendor skins) the ACTION_VIEW intent can trigger the
//     download manager for arbitrary https URLs alongside the
//     browser, producing a spurious .html file in the Downloads
//     folder. This has been reproduced consistently on Pixel and
//     Samsung devices.
//   * Fix: use `expo-web-browser`'s
//     `openBrowserAsync` which opens the URL in a Chrome Custom Tab
//     (CCT) — an in-app browser view that is guaranteed to just
//     render the page and never surface an intent chooser or the
//     download manager. CCT keeps the user in-app, respects our
//     redirect back to `stellartimelock://` (the app's own scheme),
//     and is Google's recommended pattern for OAuth / hosted flows.
//
// iOS (native):
//   * Behaves cleanly with either `Linking.openURL` or
//     `expo-web-browser`. We use `openBrowserAsync` on iOS too for
//     consistency and because SFSafariViewController (what CCT maps
//     to on iOS) gives a nicer in-app modal presentation with a
//     Cancel button.

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { colors } from "@/src/theme";

export async function openExternalUrl(url: string): Promise<void> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    // Top-level navigation instead of window.open. Avoids popup
    // blockers and the iframe-preview-download behaviour.
    window.location.href = url;
    return;
  }

  // NATIVE — Chrome Custom Tabs (Android) / SFSafariViewController
  // (iOS). Falls back to Linking.openURL only if the WebBrowser
  // module rejects the URL (e.g. non-http scheme).
  try {
    await WebBrowser.openBrowserAsync(url, {
      // Match the app's dark theme so the CCT header doesn't flash
      // white when the transition animation runs.
      toolbarColor: colors.background,
      controlsColor: colors.teal,
      dismissButtonStyle: "cancel",
    });
  } catch {
    await Linking.openURL(url);
  }
}
