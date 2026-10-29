// Private on-device copy of the Key Manager save.
// Atomic replace, .bak1–.bak5, and a confirm step when the new file is
// empty or smaller than the current one. The picker never writes this file.

import { Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import {
  type OverwriteBlock,
  type SaveFs,
  protectedWrite,
} from "@/src/utils/protected-save";

export const KEY_MANAGER_SAVE_DIR = "stellartimelock/";
export const KEY_MANAGER_SAVE_FILE = "key-manager.json";
/** First plaintext copy, kept only until the sealed file verifies. */
export const KEY_MANAGER_PLAINTEXT_BACKUP = "key-manager.plaintext.bak";

function confirmWithAlert(block: OverwriteBlock): Promise<boolean> {
  const title =
    block.reason === "empty" ? "Overwrite empty save?" : "Overwrite smaller save?";
  const message =
    block.reason === "empty"
      ? `This would replace a ${block.previousBytes}-byte key save with an empty file. Older copies are kept as .bak1 through .bak5.`
      : `This would shrink the key save from ${block.previousBytes} bytes to ${block.nextBytes} bytes. Older copies are kept as .bak1 through .bak5.`;
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
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(
      () => undefined,
    );
  },
};

export async function backupKeyManagerPlaintext(payload: string): Promise<void> {
  const root = FileSystem.documentDirectory;
  if (!root) {
    throw new Error("Could not back up Key Manager secrets, so they were left unchanged.");
  }
  const directory = `${root}${KEY_MANAGER_SAVE_DIR}`;
  await expoSaveFs.mkdir(directory);
  const path = `${directory}${KEY_MANAGER_PLAINTEXT_BACKUP}`;
  if (await expoSaveFs.exists(path)) {
    const existing = await expoSaveFs.read(path).catch(() => "");
    if (existing.length > 0) return;
  }
  await expoSaveFs.write(path, payload);
  const written = await expoSaveFs.read(path).catch(() => "");
  if (written !== payload) {
    throw new Error("Could not back up Key Manager secrets, so they were left unchanged.");
  }
}

export async function removeVerifiedPlaintextBackups(): Promise<void> {
  const { payloadHasPlaintextSecrets } = await import("@/src/security/key-manager-at-rest");
  const root = FileSystem.documentDirectory;
  if (!root) return;
  const directory = `${root}${KEY_MANAGER_SAVE_DIR}`;
  const names = await expoSaveFs.list(directory).catch(() => [] as string[]);
  for (const name of names) {
    const isPlaintextCopy =
      name === KEY_MANAGER_PLAINTEXT_BACKUP ||
      /^key-manager\.json\.bak[1-5]$/.test(name);
    if (!isPlaintextCopy) continue;
    const path = `${directory}${name}`;
    const body = await expoSaveFs.read(path).catch(() => "");
    if (payloadHasPlaintextSecrets(body)) {
      await expoSaveFs.remove(path);
    }
  }
}

export async function saveKeyManagerPayload(
  payload: string,
  opts?: { confirmShrink?: boolean },
): Promise<void> {
  const root = FileSystem.documentDirectory;
  if (!root) return;
  await protectedWrite({
    fs: expoSaveFs,
    directory: `${root}${KEY_MANAGER_SAVE_DIR}`,
    fileName: KEY_MANAGER_SAVE_FILE,
    next: payload,
    confirmShrink: opts?.confirmShrink,
    confirm: confirmWithAlert,
  });
}
