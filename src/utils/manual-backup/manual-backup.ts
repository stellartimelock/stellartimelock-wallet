// Manual JSON backup / restore.
//
// Export flow:
//   1. We ALWAYS write the file to `documentDirectory` first (stable,
//      not cache — persists across app restarts).
//   2. On Android we ALSO try to persist a copy into a user-chosen
//      folder via Storage Access Framework (SAF). The first export
//      prompts the user to pick a folder (we recommend "Stellar TimeLock"
//      or Downloads); subsequent exports reuse the granted URI silently.
//      The picked location is visible in the OS Files app.
//   3. We return a rich `ExportResult` so the calling UI can render a
//      proper "Backup saved" modal with filename, size, path, and
//      Share / Copy Path / Save Elsewhere buttons.
//   4. On web we trigger a real browser download via a Blob URL.
//
// The payload is still AES-256 encrypted with the wallet-seed-derived
// key so a leaked file is worthless without the seed.

import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Linking, Platform } from "react-native";

import { decryptBackupAsync } from "@/src/security/backup-crypto";
import { encrypt } from "@/src/security/crypto";
import { openClassifiedBackup, type RestoreTone } from "@/src/utils/manual-backup/classify-picked-file";
import {
  BACKUP_FOLDER_PROMPT,
  backupAppDirectory,
  shouldPromptForBackupFolder,
} from "@/src/utils/manual-backup/backup-location";
import { readTextOrExplain, unreadableFileMessage, withTimeout } from "@/src/utils/manual-backup/read-backup-text";
import { planSaveReplace } from "@/src/utils/save-compat";
import { storage } from "@/src/utils/storage";
import { SaveOverwriteDeclined, protectedWrite } from "@/src/utils/protected-save";
import {
  applyEnvelope,
  buildEnvelope,
  type BackupEnvelope,
  type ApplyEnvelopeResult,
} from "@/src/utils/backup-envelope";

export const MANUAL_BACKUP_MIME = "application/json";
// OS save path helpers — re-exported for callers, imported for internal use.
export {
  MANUAL_BACKUP_EXT,
  OS_SAVE_EXT,
  OS_SAVE_APP_NAME,
  osSavePath,
  stemFromFileName,
} from "./os-save-path";
import { MANUAL_BACKUP_EXT, OS_SAVE_EXT, OS_SAVE_APP_NAME, stemFromFileName } from "./os-save-path";
const SAF_DIR_URI_KEY = "xlm_vault_manual_backup_saf_dir_v1";
const LAST_BACKUP_KEY = "xlm_vault_manual_backup_last_v1";
const BACKUP_FOLDER_PROMPTED_KEY = "xlm_vault_backup_folder_prompted_v1";

/** Metadata for the most recent successful export (used by overwrite). */
export interface LastBackupMeta {
  fileName: string;
  documentUri: string;
  externalUri?: string;
  externalLabel?: string;
  at: number;
}

interface ExportedFile {
  format: "stellar-timelock-backup";
  v: 1;
  created_at: number;
  payload: string; // ciphertext produced by src/notebook/crypto.ts#encrypt
}

/** Where the file landed, in a form the UI can render + reopen. */
export interface SavedLocation {
  /** Persistent app-owned copy inside documentDirectory. Always set. */
  documentUri: string;
  /**
   * Android only. Present when a Storage Access Framework
   * copy was successfully written into the user's chosen folder.
   * URI is a SAF `content://` scheme; not directly readable by the
   * app after this write but visible in the OS Files app / Downloads.
   */
  externalUri?: string;
  /** Friendly folder name for the external copy ("Downloads" / user pick). */
  externalLabel?: string;
}

export interface ExportResult {
  ok: boolean;
  fileName?: string;
  saved?: SavedLocation;
  fileSize?: number;
  notes: number;
  bills: number;
  addresses: number;
  ledger: number;
  ledgerSlots: number;
  totp: number;
  /** Number of Key Manager saved-key entries in the envelope. */
  keys: number;
  /** Number of wallet nicknames (wallet-book meta) in the envelope. */
  wallets: number;
  /**
   * Number of dashboard widgets in the shipped
   * home layout, or `undefined` if the envelope carried no prefs.
   */
  homeLayout?: number;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  applied?: ApplyEnvelopeResult;
  error?: string;
  /** info names a file that is not a wallet backup. error is a real backup that did not open. */
  tone?: RestoreTone;
}

async function getSavedSafDirUri(): Promise<string | null> {
  const raw = await storage.getItem<string>(SAF_DIR_URI_KEY, "");
  return raw && raw.length > 0 ? raw : null;
}

async function forgetSavedSafDirUri(): Promise<void> {
  await storage.setItem(SAF_DIR_URI_KEY, "");
}

/**
 * Ask the user (once) to pick a folder using the SAF picker. We save
 * the URI so subsequent exports write silently.
 *
 * Behaviour when `interactive=false`: return the previously-saved URI
 * if we have one; otherwise return null without prompting.
 */
async function ensureSafDirUri(interactive: boolean): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  const existing = await getSavedSafDirUri();
  if (existing) return existing;
  if (!interactive) return null;

  const SAF = (
    FileSystem as unknown as {
      StorageAccessFramework?: {
        requestDirectoryPermissionsAsync: (
          initialUri?: string,
        ) => Promise<{ granted: boolean; directoryUri?: string }>;
      };
    }
  ).StorageAccessFramework;
  if (!SAF?.requestDirectoryPermissionsAsync) return null;
  try {
    const res = await SAF.requestDirectoryPermissionsAsync();
    if (res.granted && res.directoryUri) {
      await storage.setItem(SAF_DIR_URI_KEY, res.directoryUri);
      return res.directoryUri;
    }
    return null;
  } catch {
    return null;
  }
}

async function getSaf(): Promise<{
  createFileAsync: (
    parentUri: string,
    fileName: string,
    mimeType: string,
  ) => Promise<string>;
  writeAsStringAsync: (
    fileUri: string,
    contents: string,
    options?: { encoding?: string },
  ) => Promise<void>;
} | null> {
  const SAF = (
    FileSystem as unknown as {
      StorageAccessFramework?: {
        createFileAsync: (
          parentUri: string,
          fileName: string,
          mimeType: string,
        ) => Promise<string>;
        writeAsStringAsync: (
          fileUri: string,
          contents: string,
          options?: { encoding?: string },
        ) => Promise<void>;
      };
    }
  ).StorageAccessFramework;
  if (!SAF?.createFileAsync || !SAF?.writeAsStringAsync) return null;
  return SAF;
}

async function writeSafFile(
  dirUri: string,
  fileName: string,
  contents: string,
  /** When set, overwrite this existing SAF file instead of creating a new one. */
  existingFileUri?: string,
): Promise<string | null> {
  const SAF = await getSaf();
  if (!SAF) return null;
  try {
    if (existingFileUri) {
      let previous = "";
      try {
        previous = await FileSystem.readAsStringAsync(existingFileUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } catch {
        previous = "";
      }
      if (previous) {
        try {
          const bakUri = await SAF.createFileAsync(dirUri, `${fileName}.bak`, MANUAL_BACKUP_MIME);
          await SAF.writeAsStringAsync(bakUri, previous);
        } catch {
          return null;
        }
      }
      await SAF.writeAsStringAsync(existingFileUri, contents);
      return existingFileUri;
    }
    const fileUri = await SAF.createFileAsync(
      dirUri,
      fileName,
      MANUAL_BACKUP_MIME,
    );
    await SAF.writeAsStringAsync(fileUri, contents);
    return fileUri;
  } catch {
    // If the previously-granted dir was revoked (user deleted the
    // permission) drop the cached URI so the next export re-prompts.
    await forgetSavedSafDirUri();
    return null;
  }
}

export async function getLastBackupMeta(): Promise<LastBackupMeta | null> {
  const raw = await storage.getItem<LastBackupMeta | null>(LAST_BACKUP_KEY, null);
  if (!raw || typeof raw !== "object" || !raw.fileName || !raw.documentUri) {
    return null;
  }
  return raw;
}

async function saveLastBackupMeta(meta: LastBackupMeta): Promise<void> {
  await storage.setItem(LAST_BACKUP_KEY, meta);
}

/**
 * Write `contents` to the `.os` path under `OS/StellarTimeLock/` inside
 * `documentDirectory`. Creates intermediate directories if they are absent.
 * Never overwrites an existing file with a **shorter** payload (backward
 * compat protection). Returns the written URI, or `null` on failure (the
 * caller treats this as a non-fatal advisory write).
 */
async function writeOsSave(
  baseDir: string,
  stem: string,
  contents: string,
): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const osDir = `${baseDir.endsWith("/") ? baseDir : `${baseDir}/`}OS/${OS_SAVE_APP_NAME}`;
    const osInfo = await FileSystem.getInfoAsync(osDir);
    if (!osInfo.exists) {
      await FileSystem.makeDirectoryAsync(osDir, { intermediates: true });
    }
    const fileName = `${stem}.${OS_SAVE_EXT}`;
    const path = `${osDir}/${fileName}`;
    try {
      await protectedWrite({
        fs: {
          exists: async (target) => (await FileSystem.getInfoAsync(target)).exists,
          read: (target) =>
            FileSystem.readAsStringAsync(target, { encoding: FileSystem.EncodingType.UTF8 }),
          write: (target, next) =>
            FileSystem.writeAsStringAsync(target, next, {
              encoding: FileSystem.EncodingType.UTF8,
            }),
          remove: (target) => FileSystem.deleteAsync(target, { idempotent: true }),
          move: (from, to) => FileSystem.moveAsync({ from, to }),
          copy: (from, to) => FileSystem.copyAsync({ from, to }),
          list: (directory) => FileSystem.readDirectoryAsync(directory),
          mkdir: (directory) =>
            FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(
              () => undefined,
            ),
        },
        directory: osDir,
        fileName,
        next: contents,
      });
    } catch (err) {
      if (err instanceof SaveOverwriteDeclined) return path;
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * Convert a SAF tree URI into a document URI that DocumentsUI can
 * browse with ACTION_VIEW. Tree URIs (…/tree/…) often fail to open;
 * the matching …/document/… form is what file managers expect.
 */
function treeUriToDocumentUri(treeUri: string): string {
  if (treeUri.includes("/tree/") && !treeUri.includes("/document/")) {
    return treeUri.replace("/tree/", "/document/");
  }
  return treeUri;
}

/**
 * Best-effort parent folder URI for a SAF file document URI.
 * `…/document/primary%3ADownload%2Ffoo.stvault` → `…/document/primary%3ADownload`
 */
function parentFolderDocumentUri(fileUri: string): string | null {
  try {
    const marker = "/document/";
    const idx = fileUri.indexOf(marker);
    if (idx < 0) return null;
    const prefix = fileUri.slice(0, idx + marker.length);
    const docId = decodeURIComponent(fileUri.slice(idx + marker.length));
    const slash = docId.lastIndexOf("/");
    if (slash <= 0) return null;
    const parentId = docId.slice(0, slash);
    return prefix + encodeURIComponent(parentId);
  } catch {
    return null;
  }
}

/** Decode a SAF `content://` uri into something readable for the UI. */
export function labelForSafUri(uri: string | undefined | null): string | null {
  if (!uri) return null;
  try {
    // Typical SAF tree URIs look like:
    //   content://com.android.externalstorage.documents/tree/primary%3ADownload
    //   content://com.android.externalstorage.documents/document/primary%3ADownload%2Ffoo.stvault
    const decoded = decodeURIComponent(uri);
    const m = decoded.match(/(?:tree|document)\/([^:]+):([^/]+)/);
    if (m) {
      const vol = m[1] === "primary" ? "Internal storage" : m[1];
      const folder = m[2] || "(root)";
      return `${vol} › ${folder}`;
    }
    return decoded;
  } catch {
    return uri;
  }
}


function b64(s: string): string {
  const g = globalThis as unknown as { btoa?: (v: string) => string };
  if (typeof g.btoa === "function") {
    return g.btoa(unescape(encodeURIComponent(s)));
  }
  return Buffer.from(s, "utf-8").toString("base64");
}

function fromB64(s: string): string {
  const g = globalThis as unknown as { atob?: (v: string) => string };
  if (typeof g.atob === "function") {
    try {
      return decodeURIComponent(escape(g.atob(s)));
    } catch {
      return g.atob(s);
    }
  }
  return Buffer.from(s, "base64").toString("utf-8");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const info = await withTimeout(FileSystem.getInfoAsync(path), 8_000);
    return !!info?.exists;
  } catch {
    return false;
  }
}

/** Automatic copy under `StellarTimeLock backups/<app>/`. A failure does not undo the main file. */
async function writeAppBackupCopy(baseDir: string, fileName: string, contents: string): Promise<void> {
  try {
    const directory = backupAppDirectory(baseDir, OS_SAVE_APP_NAME);
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
    const path = `${directory}/${fileName}`;
    const exists = await pathExists(path);
    if (exists) {
      const previous = await readTextOrExplain(fileName, () =>
        FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }),
      );
      if (!previous.ok) return;
      const plan = planSaveReplace({
        targetExists: true,
        previous: previous.raw,
        next: contents,
      });
      if (!plan.replace) return;
      await FileSystem.copyAsync({ from: path, to: `${path}.bak` }).catch(() => undefined);
    }
    await FileSystem.writeAsStringAsync(path, contents, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    /* advisory */
  }
}

/**
 * True once, when neither the new backup folder nor the old OS/SAF
 * location can be opened. The UI shows one prompt and then remembers.
 */
export async function backupFolderPromptNeeded(): Promise<{ prompt: boolean; message: string }> {
  if (Platform.OS === "web") return { prompt: false, message: BACKUP_FOLDER_PROMPT };
  const alreadyPrompted = await storage.getItem<boolean>(BACKUP_FOLDER_PROMPTED_KEY, false);
  const base = FileSystem.documentDirectory ?? "";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const saf = await getSavedSafDirUri();
  const [newFolderExists, oldFolderExists, safExists] = await Promise.all([
    base ? pathExists(backupAppDirectory(base, OS_SAVE_APP_NAME)) : Promise.resolve(false),
    base ? pathExists(`${prefix}OS/${OS_SAVE_APP_NAME}`) : Promise.resolve(false),
    saf ? pathExists(saf) : Promise.resolve(false),
  ]);
  return {
    prompt: shouldPromptForBackupFolder({
      newFolderExists,
      oldPathExists: oldFolderExists || safExists,
      alreadyPrompted: !!alreadyPrompted,
    }),
    message: BACKUP_FOLDER_PROMPT,
  };
}

export async function markBackupFolderPrompted(): Promise<void> {
  await storage.setItem(BACKUP_FOLDER_PROMPTED_KEY, true);
}

interface ExportOptions {
  /**
   * When true (default) AND the platform is Android, prompts the SAF
   * folder picker if we don't already have a saved directory URI.
   * Callers use `interactive=false` for silent re-exports.
   */
  interactive?: boolean;
  /**
   * When true, reuse the last exported filename (and SAF file URI when
   * still writable) instead of creating a new timestamped file.
   */
  overwrite?: boolean;
}

/**
 * Serialise the current local state to an encrypted `.stvault` file
 * saved to persistent locations:
 *   • Always: `documentDirectory/stellar-timelock-backup-<ts>.stvault`
 *   • Always: `documentDirectory/StellarTimeLock backups/StellarTimeLock/<file>`
 *   • Android + SAF grant: the user-picked folder (visible in Files app)
 *   • Web: real browser download via Blob
 *
 * Does NOT auto-invoke the share sheet — the caller decides when to
 * show the OS share picker via `shareBackupFile()`.
 */
export async function exportManualBackup(
  secretSeed: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const interactive = opts.interactive ?? true;
  const overwrite = opts.overwrite ?? false;
  try {
    const env = await buildEnvelope();
    const ciphertext = await encrypt(JSON.stringify(env), secretSeed);
    const file: ExportedFile = {
      format: "stellar-timelock-backup",
      v: 1,
      created_at: Date.now(),
      payload: ciphertext,
    };
    const contents = JSON.stringify(file);
    const last = overwrite ? await getLastBackupMeta() : null;
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const fileName =
      last?.fileName ??
      `stellar-timelock-backup-${timestamp}.${MANUAL_BACKUP_EXT}`;

    if (Platform.OS === "web") {
      try {
        const blob = new Blob([contents], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        return {
          ok: false,
          notes: 0,
          bills: 0,
          addresses: 0,
          ledger: 0,
          ledgerSlots: 0,
          totp: 0,
          keys: 0,
          wallets: 0,
          error:
            "Browser download blocked. Try again in the mobile app, or copy the payload from the debugger.",
        };
      }
      const webSaved: SavedLocation = {
        documentUri: `browser://Downloads/${fileName}`,
        externalLabel: "Downloads (browser)",
      };
      await saveLastBackupMeta({
        fileName,
        documentUri: webSaved.documentUri,
        externalLabel: webSaved.externalLabel,
        at: Date.now(),
      });
      return {
        ok: true,
        fileName,
        saved: webSaved,
        fileSize: contents.length,
        notes: env.notes.length,
        bills: env.bills.length,
        addresses: env.addresses.length,
        ledger: (env.ledger ?? []).length,
        ledgerSlots: (env.ledgerSlots ?? []).length,
        totp: (env.totp ?? []).length,
        keys: (env.keyManager ?? []).length,
        wallets: (env.walletMeta ?? []).length,
        homeLayout: env.prefs?.homeLayout?.length,
      };
    }

    const dir = FileSystem.documentDirectory;
    if (!dir) throw new Error("No writable directory available.");
    // Overwrite reuses the prior document path when it still lives under
    // our documentDirectory; otherwise write a fresh path with the same name.
    const documentUri =
      last?.documentUri && last.documentUri.startsWith(dir)
        ? last.documentUri
        : `${dir}${fileName}`;
    const existingDoc = await FileSystem.getInfoAsync(documentUri);
    let previousDoc: string | null = null;
    if (existingDoc.exists) {
      try {
        previousDoc = await FileSystem.readAsStringAsync(documentUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        await FileSystem.copyAsync({ from: documentUri, to: `${documentUri}.bak` });
      } catch {
        throw new Error("Could not back up the existing save, so it was left unchanged.");
      }
    }
    const docPlan = planSaveReplace({
      targetExists: existingDoc.exists,
      previous: previousDoc,
      next: contents,
    });
    if (!docPlan.replace) {
      throw new Error("The new save is shorter, so the existing file was left unchanged.");
    }
    await FileSystem.writeAsStringAsync(documentUri, contents, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    // Also write a `.os` copy under OS/StellarTimeLock/ per STL_CORE SaveFolder
    // convention. This write is advisory — failures do not abort the export.
    await writeOsSave(dir, stemFromFileName(fileName), contents);
    await writeAppBackupCopy(dir, fileName, contents);

    let externalUri: string | undefined;
    let externalLabel: string | undefined;
    if (Platform.OS === "android") {
      const dirUri = await ensureSafDirUri(interactive);
      if (dirUri) {
        const written = await writeSafFile(
          dirUri,
          fileName,
          contents,
          overwrite ? last?.externalUri : undefined,
        );
        if (written) {
          externalUri = written;
          externalLabel = labelForSafUri(dirUri) ?? "Selected folder";
        } else if (overwrite && last?.externalUri) {
          // Prior SAF file gone — create a new one with the same name.
          const recreated = await writeSafFile(dirUri, fileName, contents);
          if (recreated) {
            externalUri = recreated;
            externalLabel = labelForSafUri(dirUri) ?? "Selected folder";
          }
        }
      }
    }

    const saved: SavedLocation = {
      documentUri,
      externalUri,
      externalLabel,
    };
    await saveLastBackupMeta({
      fileName,
      documentUri,
      externalUri,
      externalLabel,
      at: Date.now(),
    });

    return {
      ok: true,
      fileName,
      saved,
      fileSize: contents.length,
      notes: env.notes.length,
      bills: env.bills.length,
      addresses: env.addresses.length,
      ledger: (env.ledger ?? []).length,
      ledgerSlots: (env.ledgerSlots ?? []).length,
      totp: (env.totp ?? []).length,
      keys: (env.keyManager ?? []).length,
      wallets: (env.walletMeta ?? []).length,
      homeLayout: env.prefs?.homeLayout?.length,
    };
  } catch (e) {
    return {
      ok: false,
      notes: 0,
      bills: 0,
      addresses: 0,
      ledger: 0,
      ledgerSlots: 0,
      totp: 0,
      keys: 0,
      wallets: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Open the OS share sheet for a previously-exported file. Separate
 * from `exportManualBackup` so the UI can render the confirmation
 * screen first and let the user opt into sharing.
 */
export async function shareBackupFile(uri: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (Platform.OS === "web") {
    return { ok: false, error: "Web export uses direct browser download." };
  }
  try {
    const canShare = await Sharing.isAvailableAsync().catch(() => false);
    if (!canShare) {
      return { ok: false, error: "Sharing is not available on this device." };
    }
    await Sharing.shareAsync(uri, {
      mimeType: MANUAL_BACKUP_MIME,
      dialogTitle: "Save Stellar TimeLock backup",
      UTI: "public.json",
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Manually prompt the SAF folder picker (Android). Called by the
 * "Change save folder" button in the UI. On other platforms this
 * resolves to `null` so the button can be hidden.
 */
export async function pickAndroidSaveFolder(): Promise<{
  ok: boolean;
  dirUri?: string;
  label?: string | null;
  error?: string;
}> {
  if (Platform.OS !== "android") {
    return { ok: false, error: "Available on Android only." };
  }
  await forgetSavedSafDirUri();
  const dirUri = await ensureSafDirUri(true);
  if (!dirUri) return { ok: false, error: "Folder pick cancelled." };
  return { ok: true, dirUri, label: labelForSafUri(dirUri) };
}

export async function getCurrentAndroidSaveFolderLabel(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  const dirUri = await getSavedSafDirUri();
  return labelForSafUri(dirUri);
}

// "Open folder" after export — behaviour varies by platform (see matrix below).
//
//   Platform | externalUri (SAF file) | documentUri only        | web
//   ---------+------------------------+-------------------------+-----------
//   Android  | ACTION_VIEW intent on  | Try to open the OS      | n/a
//            | the SAF content://     | Downloads app; if none, |
//            | file uri (flags:       | prompt the SAF picker so|
//            | FLAG_GRANT_READ_URI_.. | future exports land in  |
//            | ..PERMISSION)          | a visible folder.       |
//            |                        |                         |
//   iOS      | share sheet (no true   | share sheet             | n/a
//            | "open folder" on iOS)  |                         |
//            |                        |                         |
//   web      | n/a                    | n/a                     | toast: check
//            |                        |                         | Downloads
//
// Any failure surfaces an error string; the caller decides whether
// to fall back to a copy-to-clipboard toast.

export interface OpenLocationResult {
  ok: boolean;
  /** True when we launched a SAF picker instead of viewing (so the UI
   *  knows to re-run the export silently after the picker returns). */
  reranSafPicker?: boolean;
  error?: string;
}

/**
 * Open the physical location of a previously-exported backup.
 *
 * Requires the same `SavedLocation` object that `exportManualBackup`
 * returned. Never throws — errors are surfaced via the return value
 * so the calling UI can render a toast rather than a crash.
 */
export async function openBackupLocation(
  saved: SavedLocation | undefined,
): Promise<OpenLocationResult> {
  if (!saved) return { ok: false, error: "No saved location to open." };

  if (Platform.OS === "web") {
    // The browser download already popped a chooser; nothing to open.
    return {
      ok: false,
      error: "Web exports go straight to your browser's Downloads folder.",
    };
  }

  if (Platform.OS === "android") {
    const safDirUri = await getSavedSafDirUri();
    // Prefer the user-visible SAF folder (converted to a browsable
    // document URI). Fall back to the parent of the written file URI.
    const candidates: string[] = [];
    if (safDirUri) {
      candidates.push(treeUriToDocumentUri(safDirUri));
      candidates.push(safDirUri);
    }
    if (saved.externalUri) {
      const parent = parentFolderDocumentUri(saved.externalUri);
      if (parent) candidates.push(parent);
      candidates.push(saved.externalUri);
    }

    for (const uri of candidates) {
      try {
        await IntentLauncher.startActivityAsync(
          "android.intent.action.VIEW",
          {
            data: uri,
            type: "vnd.android.document/directory",
            // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
            flags: 1 | 268435456,
          },
        );
        return { ok: true };
      } catch {
        try {
          await IntentLauncher.startActivityAsync(
            "android.intent.action.VIEW",
            {
              data: uri,
              flags: 1 | 268435456,
            },
          );
          return { ok: true };
        } catch {
          /* try next candidate */
        }
      }
    }

    // No browsable SAF location — do NOT open Downloads (files are not
    // there). Prompt for a visible folder, or share the app-private copy.
    const picked = await ensureSafDirUri(true);
    if (picked) {
      return { ok: true, reranSafPicker: true };
    }

    try {
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare && saved.documentUri) {
        await Sharing.shareAsync(saved.documentUri, {
          mimeType: MANUAL_BACKUP_MIME,
          dialogTitle: "Open or save the backup file",
          UTI: "public.json",
        });
        return { ok: true };
      }
    } catch {
      /* fallthrough */
    }

    return {
      ok: false,
      error:
        "Couldn't open the backup folder. Pick a save folder first, or use Share file.",
    };
  }

  if (Platform.OS === "ios") {
    try {
      const canShare = await Sharing.isAvailableAsync().catch(() => false);
      if (canShare) {
        await Sharing.shareAsync(saved.documentUri, {
          mimeType: MANUAL_BACKUP_MIME,
          dialogTitle: "Reveal or save the backup file",
          UTI: "public.json",
        });
        return { ok: true };
      }
      // Absolute last resort — try opening the raw uri.
      await Linking.openURL(saved.documentUri);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return { ok: false, error: "Unsupported platform." };
}

export interface PickedBackup {
  fileName: string;
  raw: string;
}

export async function pickManualBackupFile(): Promise<
  { ok: true; file: PickedBackup } | { ok: false; error: string }
> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled || !res.assets || res.assets.length === 0) {
      return { ok: false, error: "Import cancelled." };
    }
    const asset = res.assets[0];
    const fileName = asset.name || "backup.stvault";
    let read: { ok: true; raw: string } | { ok: false; error: string };
    if (Platform.OS === "web") {
      read = await readTextOrExplain(fileName, async () => {
        if (asset.file) return asset.file.text();
        const resp = await fetch(asset.uri);
        if (!resp.ok) throw new Error("missing");
        return resp.text();
      });
    } else {
      if (!asset.uri.startsWith("content:")) {
        const exists = await pathExists(asset.uri);
        if (!exists) return { ok: false, error: unreadableFileMessage(fileName) };
      }
      read = await readTextOrExplain(fileName, () =>
        FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        }),
      );
    }
    if (!read.ok) return { ok: false, error: read.error };
    return {
      ok: true,
      file: {
        fileName,
        raw: read.raw,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function restoreManualBackupPayload(
  secretSeed: string,
  raw: string,
  fileName = "backup",
  hooks?: { onProgress?: (message: string) => void },
): Promise<ImportResult> {
  const report = (message: string) => {
    try {
      hooks?.onProgress?.(message);
    } catch {
      /* progress is advisory */
    }
  };
  try {
    report("Opening backup…");
    // Yielding decrypt. v3 is 100,000 PBKDF2 rounds; the sync opener
    // froze the screen on a large file. A failed open does not write.
    const opened = await openClassifiedBackup(fileName, raw, secretSeed, decryptBackupAsync);
    if (!opened.ok) {
      return { ok: false, error: opened.error, tone: opened.tone };
    }

    let env: BackupEnvelope;
    try {
      env = JSON.parse(opened.plaintext) as BackupEnvelope;
    } catch {
      return {
        ok: false,
        tone: "error",
        error: `\u201c${fileName}\u201d opened, but the backup inside was corrupt.`,
      };
    }

    const applied = await applyEnvelope(env, { onProgress: report });
    if (applied.error) {
      return { ok: false, tone: "error", error: applied.error, applied };
    }
    report("Restore finished.");
    return { ok: true, applied };
  } catch (e) {
    return {
      ok: false,
      tone: "error",
      error: e instanceof Error ? e.message : "Couldn\u2019t restore that backup.",
    };
  }
}

export async function importManualBackup(
  secretSeed: string,
  hooks?: { onProgress?: (message: string) => void },
): Promise<ImportResult> {
  try {
    hooks?.onProgress?.("Reading backup…");
  } catch {
    /* progress is advisory */
  }
  const picked = await pickManualBackupFile();
  if (!picked.ok) return { ok: false, error: picked.error };
  return restoreManualBackupPayload(secretSeed, picked.file.raw, picked.file.fileName, hooks);
}

// Encode helpers are exported so unit tests / dev scripts can round-trip
// payloads without relying on the platform crypto stack.
export const _internals = { b64, fromB64 };
