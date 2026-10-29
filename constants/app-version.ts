// App version constants — single source of truth for version display in Settings.
// Bump this file when cutting a release; the Settings screen reads from here.
// BUILD_NUMBER is the Android versionCode compared against the update manifest.

/** Semantic version string shown in Settings → About. */
export const APP_VERSION = "1.6.18";

/** Integer build number shown alongside the version. Increment with every release build. */
export const BUILD_NUMBER = "29";

/** Android versionCode. The update checker treats a higher manifest versionCode as newer. */
export const VERSION_CODE = Number(BUILD_NUMBER);

/** Combined display string, e.g. "v1.6.0 (11)". */
export const VERSION_DISPLAY = `v${APP_VERSION} (${BUILD_NUMBER})`;
