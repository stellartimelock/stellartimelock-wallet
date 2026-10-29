// Demo mode keeps a second store. The real-data key is never written while
// the sample store is active, and turning demo mode off does not rewrite it.

import {
  createSampleUserData,
  emptyUserData,
  type UserData,
} from "./sample-data";

export const REAL_DATA_KEY = "stellartimelock.real-user-data.v1";
export const DEMO_DATA_KEY = "stellartimelock.demo-user-data.v1";
export const DEMO_FLAG_KEY = "stellartimelock.demo-mode.v1";

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface MemoryStorage extends Storage {
  dump(): Record<string, string>;
}

export function createMemoryStorage(
  initial: Record<string, string> = {},
): MemoryStorage {
  const map = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function browserLocalStorage(): {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} | null {
  try {
    const candidate = globalThis.localStorage;
    if (!candidate || typeof candidate.getItem !== "function") return null;
    return candidate;
  } catch {
    return null;
  }
}

function createDefaultStorage(): Storage {
  const memory = createMemoryStorage();
  const local = browserLocalStorage();
  if (!local) return memory;
  return {
    async getItem(key) {
      try {
        return local.getItem(key);
      } catch {
        return memory.getItem(key);
      }
    },
    async setItem(key, value) {
      await memory.setItem(key, value);
      try {
        local.setItem(key, value);
      } catch {
        /* The in-memory copy still holds this session. */
      }
    },
  };
}

function isStringArrayField(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function parseUserData(raw: string): UserData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Stored wallet data could not be read.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("Stored wallet data could not be read.");
  }
  const record = value as Record<string, unknown>;
  if (
    !isStringArrayField(record.vaults) ||
    !isStringArrayField(record.activity) ||
    !isStringArrayField(record.contacts)
  ) {
    throw new Error("Stored wallet data could not be read.");
  }
  const wallet = record.wallet;
  if (wallet !== null && (typeof wallet !== "object" || wallet === null)) {
    throw new Error("Stored wallet data could not be read.");
  }
  return value as UserData;
}

export interface DataGate {
  isDemo(): Promise<boolean>;
  setDemo(on: boolean): Promise<void>;
  readVisible(): Promise<UserData>;
  writeVisible(next: UserData): Promise<void>;
}

export function createDataGate(storage: Storage): DataGate {
  async function isDemo(): Promise<boolean> {
    return (await storage.getItem(DEMO_FLAG_KEY)) === "1";
  }

  async function readKey(key: string, fallback: UserData | null): Promise<UserData> {
    const raw = await storage.getItem(key);
    if (raw == null) {
      if (fallback) return fallback;
      return emptyUserData();
    }
    return parseUserData(raw);
  }

  return {
    isDemo,

    async setDemo(on: boolean) {
      if (on) {
        const existing = await storage.getItem(DEMO_DATA_KEY);
        if (existing == null) {
          await storage.setItem(
            DEMO_DATA_KEY,
            JSON.stringify(createSampleUserData()),
          );
        }
        await storage.setItem(DEMO_FLAG_KEY, "1");
        return;
      }
      await storage.setItem(DEMO_FLAG_KEY, "0");
    },

    async readVisible() {
      if (await isDemo()) {
        return readKey(DEMO_DATA_KEY, createSampleUserData());
      }
      return readKey(REAL_DATA_KEY, null);
    },

    async writeVisible(next: UserData) {
      const key = (await isDemo()) ? DEMO_DATA_KEY : REAL_DATA_KEY;
      await storage.setItem(key, JSON.stringify(next));
    },
  };
}

const listeners = new Set<() => void>();
let gate = createDataGate(createDefaultStorage());

export function subscribeUserData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function getDataGate(): DataGate {
  return gate;
}

/** Private app can inject AsyncStorage (or a test double) before first read. */
export function setDataGateStorage(storage: Storage): void {
  gate = createDataGate(storage);
  emit();
}

export async function isDemoMode(): Promise<boolean> {
  return gate.isDemo();
}

export async function setDemoMode(on: boolean): Promise<void> {
  await gate.setDemo(on);
  emit();
}

export async function readVisibleUserData(): Promise<UserData> {
  return gate.readVisible();
}

export async function writeVisibleUserData(next: UserData): Promise<void> {
  await gate.writeVisible(next);
  emit();
}
