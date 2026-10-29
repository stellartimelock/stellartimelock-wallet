export interface Countdown {
  totalSeconds: number;
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

const SEC = 1;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// Calendar approximations — vault unlock_timestamp is the source of truth;
// these are display-only.
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function countdownTo(unlockTimestampSec: number, nowSec: number = Math.floor(Date.now() / 1000)): Countdown {
  const remaining = unlockTimestampSec - nowSec;
  if (remaining <= 0) {
    return {
      totalSeconds: 0,
      years: 0,
      months: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      expired: true,
    };
  }
  let r = remaining;
  const years = Math.floor(r / YEAR);
  r -= years * YEAR;
  const months = Math.floor(r / MONTH);
  r -= months * MONTH;
  const days = Math.floor(r / DAY);
  r -= days * DAY;
  const hours = Math.floor(r / HOUR);
  r -= hours * HOUR;
  const minutes = Math.floor(r / MIN);
  r -= minutes * MIN;
  const seconds = r;
  return {
    totalSeconds: remaining,
    years,
    months,
    days,
    hours,
    minutes,
    seconds,
    expired: false,
  };
}

export function formatDaysRemaining(unlockTimestampSec: number, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const remaining = unlockTimestampSec - nowSec;
  if (remaining <= 0) return "Ready to withdraw";
  const days = Math.ceil(remaining / DAY);
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil(remaining / HOUR));
    return `${hours}h remaining`;
  }
  return `${days} days remaining`;
}

/**
 * US unlock date formatter (month/day/year), independent of device locale.
 *
 * - For unlocks > 7 days away (or in the past by > 7 days): "Jun 30, 2026".
 * - For unlocks within ±7 days: also the time of day ("Jun 30, 2026 · 09:13 AM").
 *   Time is the device timezone; the calendar order stays en-US.
 */
export function formatUnlockDate(unlockTimestampSec: number): string {
  const d = new Date(unlockTimestampSec * 1000);
  const datePart = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const deltaSec = Math.abs(unlockTimestampSec * 1000 - Date.now()) / 1000;
  const WEEK_SEC = 7 * 24 * 60 * 60;
  if (deltaSec > WEEK_SEC) return datePart;
  const timePart = d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} · ${timePart}`;
}

export function formatTimestamp(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
