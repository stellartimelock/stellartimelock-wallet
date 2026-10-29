// Over-the-air update manifest location.
// Point UPDATE_MANIFEST_URL at the hosted JSON before a release build.

/**
 * Placeholder manifest URL.
 * The file is JSON: `{ versionCode, versionName, apkUrl, notes }`.
 */
export const UPDATE_MANIFEST_URL =
  "https://example.com/stellartimelock/update-manifest.json";

export interface UpdateManifest {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  notes: string;
}
