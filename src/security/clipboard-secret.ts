// Copy a seed or recovery phrase, then clear the clipboard.
// Other apps can read the clipboard while this app is not focused.
// expo-clipboard is loaded only when a caller does not inject setString,
// so node tests can exercise the timer without React Native.

export const SECRET_CLIPBOARD_CLEAR_MS = 30_000;

type SetString = (value: string) => Promise<void>;
type Schedule = (fn: () => void, ms: number) => { clear: () => void };

let pending: { clear: () => void } | null = null;

const defaultSchedule: Schedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return { clear: () => clearTimeout(handle) };
};

export async function copySecretToClipboard(
  value: string,
  deps?: { setString?: SetString; schedule?: Schedule; clearAfterMs?: number },
): Promise<void> {
  const setString = deps?.setString ?? (async (text: string) => {
    const clipboard = await import("expo-clipboard");
    await clipboard.setStringAsync(text);
  });
  const schedule = deps?.schedule ?? defaultSchedule;
  const clearAfterMs = deps?.clearAfterMs ?? SECRET_CLIPBOARD_CLEAR_MS;
  pending?.clear();
  pending = null;
  await setString(value);
  pending = schedule(() => {
    pending = null;
    void setString("");
  }, clearAfterMs);
}

export function resetSecretClipboardForTests(): void {
  pending?.clear();
  pending = null;
}
