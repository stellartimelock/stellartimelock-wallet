import { useCallback, useEffect, useState } from "react";

import { installDemoStorage } from "./install-native-storage";
import type { UserData } from "./sample-data";
import {
  isDemoMode,
  readVisibleUserData,
  setDemoMode,
  subscribeUserData,
} from "./store";

installDemoStorage();

export interface DemoModeState {
  /** False until the flag has been read. Real data stays unmounted until then. */
  ready: boolean;
  enabled: boolean;
  /** Sample store contents while demo mode is on. Null while it is off. */
  visible: UserData | null;
  error: string | null;
  setDemo: (on: boolean) => Promise<void>;
}

export function useDemoMode(): DemoModeState {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState<UserData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const on = await isDemoMode();
      setEnabled(on);
      // Real records are not loaded while the sample store is selected.
      setVisible(on ? await readVisibleUserData() : null);
      setError(null);
    } catch (caught) {
      setEnabled(true);
      setVisible(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn't load the sample wallet.",
      );
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeUserData(() => {
      void refresh();
    });
  }, [refresh]);

  const setDemo = useCallback(async (on: boolean) => {
    await setDemoMode(on);
  }, []);

  return { ready, enabled, visible, error, setDemo };
}
