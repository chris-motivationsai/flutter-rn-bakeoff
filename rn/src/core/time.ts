/** Canonical timestamp: UTC, second precision, no milliseconds (2026-11-03T06:45:00Z). */
export function toIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Builds a canonical timestamp from calendar fields (treated as UTC). Returns null for an impossible date. */
export function isoFromFields(year: number, month: number, day: number, hour: number, minute: number, second: number): string | null {
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(ms);
  const same =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day &&
    date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
  if (!same || year < 1 || year > 9999) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}Z`;
}
