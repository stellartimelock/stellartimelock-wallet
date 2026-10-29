// Pure path helpers for the OS/StellarTimeLock/ save convention.
// No React Native or Expo dependencies — safe to import in Node.js tests.

export const OS_SAVE_EXT = "os"; // STL_CORE OS/<AppName>/<type>.os convention
export const OS_SAVE_APP_NAME = "StellarTimeLock";
export const MANUAL_BACKUP_EXT = "stvault"; // Stellar TimeLock vault

/**
 * Return the path used for the `.os` save copy inside the app's
 * private `documentDirectory`.
 *
 * Layout: `{baseDir}/OS/StellarTimeLock/{stem}.os`
 */
export function osSavePath(baseDir: string, stem: string): string {
  const dir = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
  return `${dir}OS/${OS_SAVE_APP_NAME}/${stem}.${OS_SAVE_EXT}`;
}

/**
 * Derive the stem for the `.os` file from the `.stvault` filename by
 * stripping the old extension.
 */
export function stemFromFileName(fileName: string): string {
  return fileName.endsWith(`.${MANUAL_BACKUP_EXT}`)
    ? fileName.slice(0, -(MANUAL_BACKUP_EXT.length + 1))
    : fileName;
}
