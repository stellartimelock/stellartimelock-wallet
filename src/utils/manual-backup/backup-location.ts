// Where automatic backups are written, and when restore should ask
// the user to point at that folder. No React Native imports.

/** Visible folder name. Sibling apps each get a directory inside it. */
export const BACKUP_FOLDER_NAME = "StellarTimeLock backups";

/**
 * `{base}/StellarTimeLock backups/{appName}`
 * `appName` is the app directory, for this wallet `StellarTimeLock`.
 */
export function backupAppDirectory(baseDir: string, appName: string): string {
  const dir = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return `${dir}${BACKUP_FOLDER_NAME}/${appName}`;
}

export function backupFilePath(baseDir: string, appName: string, fileName: string): string {
  return `${backupAppDirectory(baseDir, appName)}/${fileName}`;
}

/**
 * Ask once when the old backup location is gone and the current
 * StellarTimeLock backups folder is not there either.
 */
export function shouldPromptForBackupFolder(input: {
  newFolderExists: boolean;
  oldPathExists: boolean;
  alreadyPrompted: boolean;
}): boolean {
  if (input.alreadyPrompted) return false;
  if (input.newFolderExists || input.oldPathExists) return false;
  return true;
}

export const BACKUP_FOLDER_PROMPT =
  "The old backup folder is missing. Point at the StellarTimeLock backups folder.";
