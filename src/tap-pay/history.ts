// Atomic tap-pay save. The device wrapper adds the Expo filesystem.
// Tests pass an in-memory filesystem and never touch the phone.

import {
  protectedWrite,
  type OverwriteBlock,
  type SaveFs,
} from "@/src/utils/protected-save";

import { PAYMENT_HISTORY_FILE } from "./constants";
import { emptyTapPaySave, parseTapPaySave, payloadForWrite, type TapPaySave } from "./save";

export async function readTapPaySave(fs: SaveFs, directory: string): Promise<TapPaySave> {
  const target = join(directory, PAYMENT_HISTORY_FILE);
  if (!(await fs.exists(target))) return emptyTapPaySave();
  try {
    const raw = await fs.read(target);
    return parseTapPaySave(raw) ?? emptyTapPaySave();
  } catch {
    return emptyTapPaySave();
  }
}

export async function writeTapPaySave(opts: {
  fs: SaveFs;
  directory: string;
  next: TapPaySave;
  confirmShrink?: boolean;
  confirm?: (block: OverwriteBlock) => Promise<boolean>;
}): Promise<void> {
  const target = join(opts.directory, PAYMENT_HISTORY_FILE);
  const previous = (await opts.fs.exists(target)) ? await opts.fs.read(target) : null;
  const payload = payloadForWrite(previous, opts.next);
  await protectedWrite({
    fs: opts.fs,
    directory: opts.directory,
    fileName: PAYMENT_HISTORY_FILE,
    next: payload,
    confirmShrink: opts.confirmShrink,
    confirm: opts.confirm,
  });
}

function join(directory: string, name: string): string {
  return directory.endsWith("/") ? `${directory}${name}` : `${directory}/${name}`;
}
