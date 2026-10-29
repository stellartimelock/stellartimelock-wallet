// Targeted console-noise filters for known UPSTREAM library
// deprecations we can't fix without forking the dependency.
//
// Each entry here MUST cite the upstream source so a future cleanup
// can verify whether the dep has been bumped and the filter can be
// retired. We deliberately keep this list narrow — anything not
// matched still gets logged so we never accidentally swallow a
// warning from our own code.

import { LogBox, Platform } from "react-native";

/**
 * Known upstream deprecation strings. Each entry is matched as a
 * substring against the formatted log message. Keep the substrings
 * narrow enough to not accidentally hide an unrelated warning.
 */
const UPSTREAM_DEPRECATIONS: readonly string[] = [
  // `@react-navigation/elements` and `react-native-screens` still pass
  // `pointerEvents` as a prop on <View>. React Native 0.76+ flagged that
  // as deprecated in favour of `style={{ pointerEvents }}`. The fix
  // belongs upstream; until those libs bump we filter just this one
  // message string to keep our developer console clean.
  "props.pointerEvents is deprecated",
];


/**
 * Install console-warn / LogBox filters for the known upstream
 * deprecation messages. Safe to call multiple times — the original
 * `console.warn` is preserved on first call and reused.
 */
export function installConsoleFilters(): void {
  // Native side — LogBox is the canonical surface.
  if (Platform.OS !== "web") {
    try {
      LogBox.ignoreLogs(UPSTREAM_DEPRECATIONS as unknown as string[]);
    } catch {
      // Older RN versions may not have LogBox in some test envs; safe to ignore.
    }
  }

  // Web — `LogBox` is a no-op shim. The warnings come through
  // `console.warn` directly, so we wrap it.
  if (Platform.OS === "web") {
    type WarnFn = (...args: unknown[]) => void;
    // Re-entrancy guard: don't double-wrap if HMR re-runs this file.
    const flagKey = "__xlmVaultConsoleFilterInstalled" as const;
    const w = console as unknown as Record<string, unknown>;
    if (w[flagKey]) return;
    const original: WarnFn = console.warn.bind(console);
    console.warn = (...args: unknown[]): void => {
      try {
        const joined = args
          .map((a) => (typeof a === "string" ? a : ""))
          .join(" ");
        for (const needle of UPSTREAM_DEPRECATIONS) {
          if (joined.includes(needle)) return; // swallow this one warning
        }
      } catch {
        // If anything inside the matcher throws, fall through to log.
      }
      original(...args);
    };
    w[flagKey] = true;
  }
}
