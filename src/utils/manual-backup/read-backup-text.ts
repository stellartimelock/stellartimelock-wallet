// Read a backup file without waiting forever.
// A missing file, a revoked Android permission, or a huge read can leave
// the native promise pending. The caller gets a plain error instead.

export const BACKUP_READ_TIMEOUT_MS = 45_000;

export function unreadableFileMessage(fileName: string): string {
  const cleaned = (fileName || "that file").replace(/[\u0000\r\n]/g, " ").trim() || "that file";
  const shown = cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
  return `Couldn\u2019t read \u201c${shown}\u201d. The file is missing or can\u2019t be opened.`;
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run `read`. If it throws, returns empty, or never settles, return a
 * plain error. The original read may still be pending; the UI does not wait.
 */
export async function readTextOrExplain(
  fileName: string,
  read: () => Promise<string>,
  timeoutMs: number = BACKUP_READ_TIMEOUT_MS,
): Promise<{ ok: true; raw: string } | { ok: false; error: string }> {
  try {
    const raw = await withTimeout(read(), timeoutMs);
    if (typeof raw !== "string") return { ok: false, error: unreadableFileMessage(fileName) };
    return { ok: true, raw };
  } catch {
    return { ok: false, error: unreadableFileMessage(fileName) };
  }
}
