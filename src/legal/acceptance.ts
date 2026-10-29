import { storage } from "@/src/utils/storage";

// Bump suffix (e.g. `_v2`) when legal text requires fresh acknowledgment.
export const LEGAL_ACCEPTANCE_KEY = "xlm_vault_legal_accepted_v1";

export interface LegalAcceptanceRecord {
  accepted: true;
  /** Unix-seconds timestamp of acceptance (device clock). */
  accepted_at: number;
  /** Version tag — must match the suffix on LEGAL_ACCEPTANCE_KEY. */
  version: "v1";
}

const EMPTY: LegalAcceptanceRecord | { accepted: false } = { accepted: false };

export async function hasAcceptedLegal(): Promise<boolean> {
  try {
    const raw = await storage.getItem<LegalAcceptanceRecord | boolean>(
      LEGAL_ACCEPTANCE_KEY,
      EMPTY as never,
    );
    if (typeof raw === "boolean") return raw === true;
    if (raw && typeof raw === "object" && "accepted" in raw) {
      return Boolean(raw.accepted);
    }
    return false;
  } catch {
    return false;
  }
}

export async function markLegalAccepted(): Promise<boolean> {
  const record: LegalAcceptanceRecord = {
    accepted: true,
    accepted_at: Math.floor(Date.now() / 1000),
    version: "v1",
  };
  try {
    return await storage.setItem(LEGAL_ACCEPTANCE_KEY, record);
  } catch {
    return false;
  }
}

export async function resetLegalAcceptance(): Promise<boolean> {
  try {
    return await storage.removeItem(LEGAL_ACCEPTANCE_KEY);
  } catch {
    return false;
  }
}
