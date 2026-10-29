import { VERSION_CODE } from "../../constants/app-version";
import {
  UPDATE_MANIFEST_URL,
  type UpdateManifest,
} from "../../constants/update-manifest";
import { fetchUpdateManifest, isNewerVersion } from "./manifest";

export type { UpdateManifest };

export type UpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current" }
  | { phase: "available"; manifest: UpdateManifest }
  | { phase: "error"; message: string };

export interface CheckForUpdateOptions {
  /** Run again even if a result is already stored. */
  force?: boolean;
  currentVersionCode?: number;
  url?: string;
  fetchImpl?: typeof fetch;
}

let status: UpdateStatus = { phase: "idle" };
let inflight: Promise<UpdateStatus> | null = null;
const listeners = new Set<() => void>();

export function getUpdateStatus(): UpdateStatus {
  return status;
}

export function subscribeUpdateStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(next: UpdateStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

function toUserMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Couldn't check for updates.";
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return "The update check timed out.";
  }
  if (/network request failed|failed to fetch|networkerror/i.test(error.message)) {
    return "Couldn't reach the update server.";
  }
  return error.message;
}

async function runCheck(options?: CheckForUpdateOptions): Promise<UpdateStatus> {
  setStatus({ phase: "checking" });
  try {
    const manifest = await fetchUpdateManifest(
      options?.url ?? UPDATE_MANIFEST_URL,
      options?.fetchImpl ?? globalThis.fetch,
    );
    const current = options?.currentVersionCode ?? VERSION_CODE;
    const next: UpdateStatus = isNewerVersion(manifest, current)
      ? { phase: "available", manifest }
      : { phase: "current" };
    setStatus(next);
    return next;
  } catch (error) {
    const next: UpdateStatus = { phase: "error", message: toUserMessage(error) };
    setStatus(next);
    return next;
  }
}

/**
 * Fetch the manifest and publish the result.
 * Launch and the Settings button share one in-flight request.
 * A failed check does not invent an update card.
 */
export async function checkForUpdate(
  options?: CheckForUpdateOptions,
): Promise<UpdateStatus> {
  if (inflight) {
    const pending = inflight;
    if (!options?.force) return pending;
    await pending.catch(() => undefined);
  }
  const run = runCheck(options);
  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

/** Test-only. Drops cached status so cases don't leak into each other. */
export function resetUpdateCheckForTests(): void {
  status = { phase: "idle" };
  inflight = null;
  listeners.clear();
}
