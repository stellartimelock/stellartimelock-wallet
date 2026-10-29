// Firebase Analytics/Crashlytics removed — pure no-op facade keeps call sites compiling.
// IMPORTANT: do NOT re-add `require("@react-native-firebase/...")` — packages are
// uninstalled and Metro would fail to resolve them on release builds.

export type AppEvent =
  | {
      name: "wallet_created";
      method: "burner" | "imported";
    }
  | {
      name: "wallet_imported";
      already_present: boolean;
    }
  | {
      name: "vault_locked";
    }
  | {
      name: "backup_synced";
      target: "gdrive" | "manual_json";
      ok: boolean;
      variant?: string;
    }
  | {
      name: "backup_restored";
      target: "gdrive" | "manual_json";
      ok: boolean;
      variant?: string;
    }
  | {
      name: "ledger_entry_added";
      surface: "detailed" | "quick" | "bulk_import";
      kind: "profit" | "loss";
    };

export function trackEvent(_event: AppEvent): void {
  /* analytics removed — no-op */
}

export function trackScreen(_screenName: string): void {
  /* analytics removed — no-op */
}

export function setUserProperty(_key: string, _value: string | null): void {
  /* analytics removed — no-op */
}

export function recordError(
  _err: unknown,
  _context?: Record<string, string | number | boolean>,
): void {
  /* crashlytics removed — no-op */
}

export function log(_message: string): void {
  /* crashlytics removed — no-op */
}

export function startTrace(_name: string): { stop: () => void } {
  return { stop: () => {} };
}

export function initFirebase(): void {
  /* analytics removed — no-op */
}

export function isFirebaseActive(): boolean {
  return false;
}
