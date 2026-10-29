// Phone copy of the tap-pay save.
// Atomic replace, .bak1–.bak5, and a confirm step when the new file is
// empty or smaller than the current one.

import { Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import {
  type OverwriteBlock,
  type SaveFs,
} from "@/src/utils/protected-save";

import { PAYMENT_HISTORY_DIR } from "./constants";
import { readTapPaySave, writeTapPaySave } from "./history";
import { emptyTapPaySave, type TapPaySave } from "./save";

function confirmWithAlert(block: OverwriteBlock): Promise<boolean> {
  const title =
    block.reason === "empty" ? "Overwrite empty payment history?" : "Overwrite smaller payment history?";
  const message =
    block.reason === "empty"
      ? `This would replace a ${block.previousBytes}-byte payment history with an empty file. Older copies stay as .bak1 through .bak5.`
      : `This would shrink the payment history from ${block.previousBytes} bytes to ${block.nextBytes} bytes. Older copies stay as .bak1 through .bak5.`;
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Overwrite", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

const expoSaveFs: SaveFs = {
  async exists(path) {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists;
  },
  async read(path) {
    return FileSystem.readAsStringAsync(path);
  },
  async write(path, contents) {
    await FileSystem.writeAsStringAsync(path, contents, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  },
  async remove(path) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  },
  async move(from, to) {
    await FileSystem.moveAsync({ from, to });
  },
  async copy(from, to) {
    await FileSystem.copyAsync({ from, to });
  },
  async list(directory) {
    return FileSystem.readDirectoryAsync(directory);
  },
  async mkdir(directory) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
  },
};

function directory(): string | null {
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  return `${root}${PAYMENT_HISTORY_DIR}`;
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function loadTapPay(): Promise<TapPaySave> {
  const dir = directory();
  if (!dir) return emptyTapPaySave();
  return readTapPaySave(expoSaveFs, dir);
}

export async function saveTapPay(
  next: TapPaySave,
  opts?: { confirmShrink?: boolean },
): Promise<void> {
  const dir = directory();
  if (!dir) return;
  await writeTapPaySave({
    fs: expoSaveFs,
    directory: dir,
    next,
    confirmShrink: opts?.confirmShrink,
    confirm: confirmWithAlert,
  });
}

/** Serialize read-modify-write so two payments cannot drop each other's row. */
export function updateTapPay(change: (doc: TapPaySave) => TapPaySave): Promise<TapPaySave> {
  return enqueue(async () => {
    const current = await loadTapPay();
    const next = change(current);
    await saveTapPay(next);
    return next;
  });
}
