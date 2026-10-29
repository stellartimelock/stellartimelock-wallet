// Load and store the one plain money document. The backup envelope
// reads and writes this same object so a restore stays backward compatible:
// older envelopes simply omit `money`.

import { storage } from "@/src/utils/storage";

import {
  emptyMoneySave,
  mergeMoneySave,
  MONEY_SAVE_KEY,
  readMoneyDocument,
  type MoneySaveFile,
} from "./save-file";

export async function loadMoneySave(): Promise<MoneySaveFile> {
  const raw = await storage.getItem<MoneySaveFile | null>(MONEY_SAVE_KEY, null);
  if (raw == null) return emptyMoneySave();
  const read = readMoneyDocument(raw);
  return read.present ? read.file : emptyMoneySave();
}

export async function writeMoneySave(file: MoneySaveFile): Promise<boolean> {
  const next: MoneySaveFile = {
    ...file,
    v: 1,
    writtenAt: Date.now(),
  };
  return storage.setItem(MONEY_SAVE_KEY, next);
}

/** Backup restore. Absent money sections are left untouched. */
export async function restoreMoneySave(raw: unknown): Promise<MoneySaveFile | null> {
  const read = readMoneyDocument(raw);
  if (!read.present) return null;
  const local = await loadMoneySave();
  const merged = mergeMoneySave(local, read.file, "restore");
  await writeMoneySave(merged);
  return merged;
}

/** CSV / save-file import keeps local rows the incoming file does not mention. */
export async function importMoneySave(raw: unknown): Promise<MoneySaveFile | null> {
  const read = readMoneyDocument(raw);
  if (!read.present) return null;
  const local = await loadMoneySave();
  const merged = mergeMoneySave(local, read.file, "import");
  await writeMoneySave(merged);
  return merged;
}
