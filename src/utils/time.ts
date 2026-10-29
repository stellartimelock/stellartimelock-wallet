/**
 * Format a wallclock timestamp (ms since epoch) as a coarse relative
 * delta — "just now", "12s ago", "5 mins ago", etc. Rounds to the
 * nearest unit so the label stays calm and never flickers between
 * "27s" and "28s" on a single render.
 */
export function formatAgo(ts: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
