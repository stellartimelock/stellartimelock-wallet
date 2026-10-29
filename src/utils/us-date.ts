/** Calendar dates use US month/day/year order, not the device locale. */
export const US_DATE_LOCALE = "en-US";

export function formatUsDate(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleDateString(US_DATE_LOCALE, options);
}

export function formatUsDateTime(
  date: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleString(US_DATE_LOCALE, options);
}
