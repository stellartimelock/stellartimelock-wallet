import {
  UPDATE_MANIFEST_URL,
  type UpdateManifest,
} from "../../constants/update-manifest";

const HTTPS = "https:";

export function assertHttpsUrl(raw: string, label: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (url.protocol !== HTTPS) {
    throw new Error(`${label} must use https.`);
  }
  return url.toString();
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Update manifest must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const { versionCode, versionName, apkUrl, notes } = record;

  if (
    typeof versionCode !== "number" ||
    !Number.isInteger(versionCode) ||
    versionCode < 0
  ) {
    throw new Error("versionCode must be a non-negative integer.");
  }
  if (typeof versionName !== "string" || versionName.trim() === "") {
    throw new Error("versionName must be a non-empty string.");
  }
  if (typeof apkUrl !== "string" || apkUrl.trim() === "") {
    throw new Error("apkUrl must be a non-empty string.");
  }
  if (typeof notes !== "string") {
    throw new Error("notes must be a string.");
  }

  return {
    versionCode,
    versionName: versionName.trim(),
    apkUrl: assertHttpsUrl(apkUrl, "apkUrl"),
    notes,
  };
}

/** True when the manifest's versionCode is strictly newer than this build. */
export function isNewerVersion(
  manifest: UpdateManifest,
  currentVersionCode: number,
): boolean {
  return manifest.versionCode > currentVersionCode;
}

export async function fetchUpdateManifest(
  url: string = UPDATE_MANIFEST_URL,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<UpdateManifest> {
  const manifestUrl = assertHttpsUrl(url, "UPDATE_MANIFEST_URL");
  const signal =
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(12_000)
      : undefined;
  const response = await fetchImpl(manifestUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Update manifest request failed (${response.status}).`);
  }
  const body: unknown = await response.json();
  return parseUpdateManifest(body);
}
