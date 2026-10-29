// Toggle Gradle Build Mode by copying all three e2e script commands (any order).

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import { AppState, AppStateStatus } from "react-native";

type Listener = (active: boolean) => void;

const STORAGE_KEY = "xlm_gradle_build_mode_v1";

let _gradleActive = false;
const _listeners = new Set<Listener>();

const TRIGGER_COMMANDS = new Set([
  "cd /app/frontend && node /app/scripts/e2e-soroban.js",
  "cd /app/frontend && node /app/scripts/e2e-events.js",
  "cd /app/frontend && node /app/scripts/e2e-errors.js",
]);
let _collectedCommands = new Set<string>();
let _watchPollTimer: ReturnType<typeof setInterval> | null = null;
let _lastClipboardText = "";

(async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === "1") {
      _gradleActive = true;
      notify();
    }
  } catch {
    /* AsyncStorage failures are non-fatal for an easter egg */
  }
})();

async function persistActive(active: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, active ? "1" : "0");
  } catch {
    /* swallow — persistence is best-effort */
  }
}

export const GRADLE_ACTIVATE_TOAST =
  "Gradle Build Mode engaged — compiling on next launch…";
export const GRADLE_DEACTIVATE_TOAST =
  "Gradle Build Mode disengaged. Normal boot restored.";

function notify() {
  for (const fn of _listeners) {
    try { fn(_gradleActive); } catch { /* swallow */ }
  }
}

/** True if Gradle Build Mode is currently active (non-reactive). */
export function isGradleActive(): boolean {
  return _gradleActive;
}

function startClipboardWatcher(): void {
  if (_watchPollTimer) return;
  _watchPollTimer = setInterval(async () => {
    try {
      const hasString = await Clipboard.hasStringAsync();
      if (!hasString) return;

      const text = await Clipboard.getStringAsync();
      const trimmed = text.trim();

      if (trimmed === _lastClipboardText) return;
      _lastClipboardText = trimmed;

      if (TRIGGER_COMMANDS.has(trimmed)) {
        _collectedCommands.add(trimmed);

        if (_collectedCommands.size === 3) {
          _gradleActive = !_gradleActive;
          notify();
          void persistActive(_gradleActive);
          _collectedCommands.clear();
        }
      } else if (trimmed.length > 0) {
        _collectedCommands.clear();
      }
    } catch {
      /* Clipboard access failures are non-fatal for an easter egg */
    }
  }, 2000);
}

function stopClipboardWatcher(): void {
  if (_watchPollTimer) {
    clearInterval(_watchPollTimer);
    _watchPollTimer = null;
  }
  _lastClipboardText = "";
}

/**
 * Reset the collected-commands set (exposed so callers can clear it
 * if desired, e.g. after a trigger).
 */
export function resetClipboardSequence(): void {
  _collectedCommands.clear();
  _lastClipboardText = "";
}

export function useGradleEasterEgg(): boolean {
  const [active, setActive] = useState<boolean>(_gradleActive);
  useEffect(() => {
    const fn: Listener = (next) => setActive(next);
    _listeners.add(fn);
    return () => {
      _listeners.delete(fn);
    };
  }, []);
  return active;
}

/**
 * React hook — mounts the clipboard watcher while the app is in the
 * foreground. Should be called once at the root of the app (e.g. in
 * RootLayout). Stops polling when the app backgrounds; resumes when it
 * returns to foreground.
 */
export function useClipboardGradleTrigger(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const handleAppStateChange = useCallback((nextState: AppStateStatus) => {
    const prev = appStateRef.current;
    appStateRef.current = nextState;

    if (prev.match(/inactive|background/) && nextState === "active") {
      startClipboardWatcher();
    }
    if (nextState.match(/inactive|background/)) {
      stopClipboardWatcher();
    }
  }, []);

  useEffect(() => {
    startClipboardWatcher();

    const sub = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      stopClipboardWatcher();
      sub.remove();
    };
  }, [handleAppStateChange]);
}