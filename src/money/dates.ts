// Calendar dates as YYYY-MM-DD in UTC. Bill schedules and the helper
// spending week both use these so tests do not depend on the device zone.

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function addDays(iso: string, days: number): string {
  if (!isIsoDate(iso)) throw new Error("Invalid date.");
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Monday of the UTC week that contains `iso`. */
export function mondayOf(iso: string): string {
  if (!isIsoDate(iso)) throw new Error("Invalid date.");
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(iso, diff);
}

export function addMonths(iso: string, months: number): string {
  if (!isIsoDate(iso)) throw new Error("Invalid date.");
  const [y, m, d] = iso.split("-").map(Number);
  const targetMonthIndex = m - 1 + months;
  const year = y + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function addYears(iso: string, years: number): string {
  return addMonths(iso, years * 12);
}

export function todayIso(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** 09:00 UTC on `iso`, when a due-date reminder fires. */
export function reminderFireAtMs(iso: string): number {
  if (!isIsoDate(iso)) throw new Error("Invalid date.");
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 9, 0, 0);
}
