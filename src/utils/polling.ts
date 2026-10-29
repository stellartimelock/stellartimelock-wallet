/**
 * Centralized polling cadence for the whole app.
 *
 * Enforces a 60-second minimum on every recurring poll (Horizon fee stats,
 * /api/prices, fiat rate refresh, Drive-status heartbeat, etc.). Import
 * `POLL_MIN_INTERVAL_MS` or `clampPollInterval` instead of hard-coding
 * `60_000`. Short-lived UX timers (countdowns, TOTP rotation) intentionally
 * do not use this constant.
 */

/**
 * The minimum interval at which any app-level poll may run, in ms.
 *
 * Currently 60 seconds — mirrors the backend /api/prices cache TTL
 * and stays under Horizon's default rate limit even with several
 * polls active at once.
 */
export const POLL_MIN_INTERVAL_MS = 60_000;

/**
 * Clamp a caller-supplied interval UP to the app-wide floor.
 *
 * Callers that want to poll less frequently (e.g. a 5-minute
 * background refresh) can pass a larger value and it will be used
 * as-is.  Anything below the floor gets bumped up silently — we
 * deliberately don't throw, because a passed-in `undefined` from a
 * broken settings read should degrade gracefully to the default,
 * not crash the caller.
 */
export function clampPollInterval(requested: number | undefined | null): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return POLL_MIN_INTERVAL_MS;
  }
  return Math.max(POLL_MIN_INTERVAL_MS, requested);
}
