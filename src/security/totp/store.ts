// TOTP entries store.
//
// Plain JSON list of user-added TOTP secrets, persisted in
// AsyncStorage. Android sandboxing protects local data; encryption is
// reserved for backup files (.stvault) only. Restoring a backup on a
// new device restores every second-factor secret via the envelope.
//
// Schema:
//   { id, name, issuer?, secret, isDefault, createdAt, updatedAt }
//
// Only ONE entry may have `isDefault === true`; helpers ensure that
// invariant on every upsert.

import { storage } from "@/src/utils/storage";

const TOTP_KEY = "xlm_vault_totp_entries_v1";

export interface TotpEntry {
  id: string;
  /** Friendly label ("Gmail — user@example.com"). Trimmed on save. */
  name: string;
  /** Optional service issuer ("Google", "GitHub"). Displayed subtly. */
  issuer?: string;
  /** Base32 secret (upper-case, no whitespace). */
  secret: string;
  /** Only one entry can be default at a time. */
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

async function readAll(): Promise<TotpEntry[]> {
  const raw = await storage.getItem<string>(TOTP_KEY, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TotpEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(entries: TotpEntry[]): Promise<void> {
  await storage.setItem(TOTP_KEY, JSON.stringify(entries));
}

function newId(): string {
  return `totp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function replaceTotpEntries(entries: TotpEntry[]): Promise<void> {
  await writeAll(entries);
}

export async function listTotpEntries(): Promise<TotpEntry[]> {
  const all = await readAll();
  return all.sort((a, b) => {
    // Default entry always first, then newest-updated.
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export async function upsertTotpEntry(input: {
  id?: string;
  name: string;
  issuer?: string;
  secret: string;
  isDefault?: boolean;
}): Promise<TotpEntry> {
  const all = await readAll();
  const now = Date.now();
  const name = (input.name ?? "").trim();
  const issuer = (input.issuer ?? "").trim() || undefined;
  const secret = input.secret.replace(/\s+/g, "").toUpperCase();
  if (!name) throw new Error("Name is required.");
  if (!secret) throw new Error("Secret is required.");

  let next: TotpEntry;
  if (input.id) {
    const idx = all.findIndex((e) => e.id === input.id);
    if (idx >= 0) {
      next = {
        ...all[idx],
        name,
        issuer,
        secret,
        isDefault: input.isDefault ?? all[idx].isDefault,
        updatedAt: now,
      };
      all[idx] = next;
    } else {
      next = {
        id: input.id,
        name,
        issuer,
        secret,
        isDefault: input.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      };
      all.push(next);
    }
  } else {
    next = {
      id: newId(),
      name,
      issuer,
      secret,
      // First-ever entry is auto-default so users get instant
      // "one-tap copy" without an extra step.
      isDefault: input.isDefault ?? all.length === 0,
      createdAt: now,
      updatedAt: now,
    };
    all.push(next);
  }
  // Enforce the single-default invariant.
  if (next.isDefault) {
    for (const e of all) {
      if (e.id !== next.id) e.isDefault = false;
    }
  }
  await writeAll(all);
  return next;
}

export async function setDefaultTotpEntry(id: string): Promise<void> {
  const all = await readAll();
  for (const e of all) e.isDefault = e.id === id;
  await writeAll(all);
}

export async function removeTotpEntry(id: string): Promise<void> {
  const all = await readAll();
  const kept = all.filter((e) => e.id !== id);
  // Promote a new default if we just deleted the current one.
  const hadDefault = kept.some((e) => e.isDefault);
  if (!hadDefault && kept.length > 0) {
    kept[0].isDefault = true;
    kept[0].updatedAt = Date.now();
  }
  await writeAll(kept);
}
