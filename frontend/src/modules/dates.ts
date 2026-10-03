/**
 * Calendar-date helpers for date-only ISO strings ("YYYY-MM-DD").
 *
 * `new Date('2026-02-22')` is parsed as UTC midnight, so in any negative-UTC
 * timezone (all of the Americas) it is still Feb 21 locally and
 * toLocaleDateString shows the wrong day (BIZ-11). Trip, destination, hotel
 * and day dates are calendar dates with no time zone, so they are parsed as
 * *local* dates here and all day arithmetic is done on the calendar, never by
 * adding milliseconds (which breaks across DST changes).
 */

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

function parseParts(iso: string | null | undefined): CalendarDate | null {
  if (typeof iso !== 'string') return null;
  const match = DATE_ONLY_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through UTC to reject impossible dates (2026-02-30, month 13).
  const check = new Date(Date.UTC(2000, 0, 1));
  check.setUTCFullYear(year, month - 1, day);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * True when `value` is a real calendar date in YYYY-MM-DD form.
 */
export function isIsoDate(value: string | null | undefined): value is string {
  return parseParts(value) !== null;
}

/**
 * Parse "YYYY-MM-DD" as local midnight of that calendar day.
 * Returns null for null/empty/malformed/impossible input.
 * (Where DST starts at midnight the result is 01:00 — still the same day.)
 */
export function parseLocalDate(iso: string | null | undefined): Date | null {
  const parts = parseParts(iso);
  if (!parts) return null;
  const date = new Date(2000, 0, 1);
  date.setFullYear(parts.year, parts.month - 1, parts.day); // setFullYear: years < 100 stay literal
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Format a Date's *local* calendar day as "YYYY-MM-DD" (unlike toISOString,
 * which uses UTC and can be off by one day).
 */
export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toUtcDays(parts: CalendarDate): number {
  const t = new Date(Date.UTC(2000, 0, 1));
  t.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return Math.round(t.getTime() / MS_PER_DAY);
}

function fromUtcDays(days: number): string {
  const t = new Date(days * MS_PER_DAY);
  const y = String(t.getUTCFullYear()).padStart(4, '0');
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Add whole calendar days to a "YYYY-MM-DD" string. Timezone/DST
 * independent: the arithmetic is done on a UTC day count.
 * Returns null when `iso` is not a valid date.
 */
export function addDays(iso: string, days: number): string | null {
  const parts = parseParts(iso);
  if (!parts || !Number.isInteger(days)) return null;
  return fromUtcDays(toUtcDays(parts) + days);
}

/**
 * Number of calendar days from `start` to `end` (end − start); negative when
 * end is before start; null when either is invalid.
 */
export function daysBetween(start: string, end: string): number | null {
  const a = parseParts(start);
  const b = parseParts(end);
  if (!a || !b) return null;
  return toUtcDays(b) - toUtcDays(a);
}

/**
 * Every date from `start` to `end`, inclusive, as "YYYY-MM-DD".
 * Empty when either is invalid or start > end. Throws RangeError when the
 * range is longer than `maxDays`, so a typo'd year can't fire thousands of
 * requests.
 */
export function eachDateInRange(start: string, end: string, maxDays = 366): string[] {
  const span = daysBetween(start, end);
  if (span === null || span < 0) return [];
  if (span + 1 > maxDays) {
    throw new RangeError(`Date range has ${span + 1} days; the maximum is ${maxDays}`);
  }
  const first = toUtcDays(parseParts(start)!);
  return Array.from({ length: span + 1 }, (_, i) => fromUtcDays(first + i));
}

/**
 * Format a "YYYY-MM-DD" string for display as the same calendar day in every
 * timezone. Returns '' for null/empty/invalid input.
 */
export function formatIsoDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-US',
): string {
  const date = parseLocalDate(iso);
  return date ? date.toLocaleDateString(locale, options) : '';
}
