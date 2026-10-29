// Overwrite protection for a single save file.
//
// Writes are atomic from the caller's point of view: the new bytes land in
// a temp file, rotating .bak1–.bak5 copies are made, then the temp file
// replaces the live file. A shrink or an empty replacement is refused
// unless the caller confirms it.

export const BACKUP_SLOTS = [1, 2, 3, 4, 5] as const;

export class SaveOverwriteDeclined extends Error {
  readonly reason: "empty" | "shrink";

  constructor(reason: "empty" | "shrink") {
    super(
      reason === "empty"
        ? "Overwrite declined (empty)."
        : "Overwrite declined (shrink).",
    );
    this.name = "SaveOverwriteDeclined";
    this.reason = reason;
  }
}

export type OverwriteBlock = {
  ok: false;
  reason: "empty" | "shrink";
  previousBytes: number;
  nextBytes: number;
};

export type OverwriteDecision = { ok: true } | OverwriteBlock;

export function backupName(fileName: string, slot: number): string {
  return `${fileName}.bak${slot}`;
}

export function isEmptySave(contents: string): boolean {
  const trimmed = contents.trim();
  return trimmed.length === 0 || trimmed === "[]" || trimmed === "{}";
}

/** Refuse an empty replacement or a smaller file unless the caller confirms. */
export function assessOverwrite(
  previous: string | null,
  next: string,
): OverwriteDecision {
  if (previous == null) return { ok: true };
  const nextEmpty = isEmptySave(next);
  const prevEmpty = isEmptySave(previous);
  if (nextEmpty && !prevEmpty) {
    return {
      ok: false,
      reason: "empty",
      previousBytes: previous.length,
      nextBytes: next.length,
    };
  }
  if (next.length < previous.length) {
    return {
      ok: false,
      reason: "shrink",
      previousBytes: previous.length,
      nextBytes: next.length,
    };
  }
  return { ok: true };
}

export type RotationStep =
  | { op: "delete"; from: string }
  | { op: "move"; from: string; to: string };

/**
 * Shift .bak1–.bak5 so slot 1 is free. The live file is not moved.
 * Oldest slot (.bak5) is deleted when a newer backup needs its place.
 */
export function backupRotation(
  existingNames: Iterable<string>,
  fileName: string,
): RotationStep[] {
  const existing = new Set(existingNames);
  const steps: RotationStep[] = [];
  const bak = (slot: number) => backupName(fileName, slot);
  if (existing.has(bak(BACKUP_SLOTS[BACKUP_SLOTS.length - 1]))) {
    steps.push({ op: "delete", from: bak(5) });
  }
  for (let slot = 4; slot >= 1; slot--) {
    if (existing.has(bak(slot))) {
      steps.push({ op: "move", from: bak(slot), to: bak(slot + 1) });
    }
  }
  return steps;
}

export interface SaveFs {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  remove(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  list(directory: string): Promise<string[]>;
  mkdir(directory: string): Promise<void>;
}

export function joinPath(directory: string, name: string): string {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("Save file name is not allowed.");
  }
  return directory.endsWith("/") ? `${directory}${name}` : `${directory}/${name}`;
}

export async function protectedWrite(opts: {
  fs: SaveFs;
  directory: string;
  fileName: string;
  next: string;
  confirmShrink?: boolean;
  confirm?: (block: OverwriteBlock) => Promise<boolean>;
}): Promise<void> {
  const { fs, directory, fileName, next } = opts;
  await fs.mkdir(directory);
  const target = joinPath(directory, fileName);
  const tmp = joinPath(directory, `${fileName}.tmp`);
  if (await fs.exists(tmp)) await fs.remove(tmp);

  const previous = (await fs.exists(target)) ? await fs.read(target) : null;
  const decision = assessOverwrite(previous, next);
  if (!decision.ok) {
    const allowed =
      opts.confirmShrink === true ||
      (opts.confirm ? await opts.confirm(decision) : false);
    if (!allowed) throw new SaveOverwriteDeclined(decision.reason);
  }

  // Temp file first. Backups and the live replace happen only after the
  // new bytes are on disk, so a failed write leaves the current file.
  await fs.write(tmp, next);
  const names = new Set(await fs.list(directory));
  for (const step of backupRotation(names, fileName)) {
    if (step.op === "delete") {
      await fs.remove(joinPath(directory, step.from));
    } else {
      const dest = joinPath(directory, step.to);
      if (await fs.exists(dest)) await fs.remove(dest);
      await fs.move(joinPath(directory, step.from), dest);
    }
  }
  if (previous != null) {
    const bak1 = joinPath(directory, backupName(fileName, 1));
    if (await fs.exists(bak1)) await fs.remove(bak1);
    await fs.copy(target, bak1);
  }
  if (await fs.exists(target)) await fs.remove(target);
  await fs.move(tmp, target);
}
