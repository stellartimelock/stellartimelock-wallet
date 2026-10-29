import { storage } from "@/src/utils/storage";

export type WidgetSize = "sm" | "md" | "lg";

export type SortKey = "balance" | "name" | "unlock" | "status";
export type StatusFilter = "all" | "locked" | "unlocked" | "withdrawn";

export interface TierMonitorPrefs {
  watchedIds: string[];
  /**
   * All position ids observed on prior loads. Used so newly created advanced
   * vaults are auto-watched even after the user customized the watchlist
   * (intentionally removed ids stay removed because they're already "known").
   */
  knownIds: string[];
  /** When false, the dashboard watches every known position by default. */
  watchlistCustomized: boolean;
  sortKey: SortKey;
  statusFilter: StatusFilter;
  widgetSize: WidgetSize;
}

const DEFAULTS: TierMonitorPrefs = {
  watchedIds: [],
  knownIds: [],
  watchlistCustomized: false,
  sortKey: "balance",
  statusFilter: "all",
  widgetSize: "md",
};

/** Merge watchlist with newly discovered vault ids (auto-watch new positions). */
export function resolveWatchedIds(
  prefs: TierMonitorPrefs,
  builtIds: string[],
): { watchedIds: string[]; knownIds: string[] } {
  const known = new Set(prefs.knownIds);
  const newIds = builtIds.filter((id) => !known.has(id));
  const knownIds = Array.from(new Set([...prefs.knownIds, ...builtIds]));
  if (!prefs.watchlistCustomized) {
    return { watchedIds: builtIds, knownIds };
  }
  const watched = new Set(prefs.watchedIds);
  for (const id of newIds) watched.add(id);
  // Drop ids that no longer exist on-chain from the allowlist display set,
  // but keep knownIds so a temporarily missing vault isn't re-auto-added
  // as "new" after a flaky RPC read.
  return { watchedIds: Array.from(watched), knownIds };
}

export type TierMonitorKey = "plus" | "pro" | "institutional";

function keyFor(tier: TierMonitorKey, owner: string): string {
  return `xlm_vault_tier_monitor_${tier}_${owner}`;
}

export async function loadTierMonitorPrefs(
  tier: TierMonitorKey,
  owner: string,
): Promise<TierMonitorPrefs> {
  const parsed = await storage.getItem<TierMonitorPrefs | null>(
    keyFor(tier, owner),
    null,
  );
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULTS, watchedIds: [], knownIds: [] };
  }
  const watchedIds = Array.isArray(parsed.watchedIds)
    ? parsed.watchedIds.filter((x): x is string => typeof x === "string")
    : [];
  const knownIds = Array.isArray((parsed as TierMonitorPrefs).knownIds)
    ? (parsed as TierMonitorPrefs).knownIds.filter(
        (x): x is string => typeof x === "string",
      )
    : // Legacy prefs: seed knownIds from watchedIds so existing removals stick.
      [...watchedIds];
  return {
    watchedIds,
    knownIds,
    watchlistCustomized: Boolean(parsed.watchlistCustomized),
    sortKey: parsed.sortKey || DEFAULTS.sortKey,
    statusFilter: parsed.statusFilter || DEFAULTS.statusFilter,
    widgetSize: parsed.widgetSize || DEFAULTS.widgetSize,
  };
}

export async function saveTierMonitorPrefs(
  tier: TierMonitorKey,
  owner: string,
  prefs: TierMonitorPrefs,
): Promise<void> {
  await storage.setItem(keyFor(tier, owner), prefs);
}
