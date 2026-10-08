import { describe, it, expect, afterEach } from 'vitest';
import {
  parseLocalDate,
  toIsoDate,
  isIsoDate,
  addDays,
  daysBetween,
  eachDateInRange,
  formatIsoDate,
} from '@/modules/dates';
import { formatDate } from '@/modules/utils';
import { apiDestinationToCityData } from '@/modules/tripAdapter';
import { buildTripEntries, searchEntries } from '@/modules/search';
import type { ApiDestination, ApiTrip } from '@/types';

// Node re-reads process.env.TZ on assignment, so each case can run in its own
// zone inside one worker (Vitest's default "forks" pool).
const ORIGINAL_TZ = process.env.TZ;
function inTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  }
}
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = [
  'UTC',
  'America/Argentina/Buenos_Aires', // -03, the live-reproduced bug
  'America/Los_Angeles', // -08/-07 with DST
  'America/New_York', // DST 2026-03-08 / 2026-11-01
  'America/Santiago', // DST starts at local midnight (00:00 does not exist)
  'America/Havana', // DST at midnight as well
  'Pacific/Pago_Pago', // -11
  'Etc/GMT+12', // -12, furthest behind UTC
  'Asia/Tokyo', // +09, the trip's own zone
  'Asia/Kolkata', // +05:30
  'Australia/Lord_Howe', // +10:30/+11, half-hour DST
  'Pacific/Auckland', // +13 in February (DST), ends 2026-04-05
  'Pacific/Kiritimati', // +14, furthest ahead of UTC
] as const;

const DATES = [
  '2026-02-22', // trip start in the bug report
  '2026-03-24',
  '2026-01-01',
  '2026-12-31',
  '2028-02-29', // leap day
  '2026-03-08', // US spring forward
  '2026-03-29', // EU spring forward
  '2026-04-05', // NZ DST ends
  '2026-09-06', // Chile DST starts at midnight
  '2026-09-27', // NZ DST starts
  '2026-11-01', // US fall back
  '0099-06-15', // two-digit year must not become 1999
];

describe('harness sanity', () => {
  it('switching TZ really changes Date parsing (the original bug is observable)', () => {
    expect(inTz('America/Argentina/Buenos_Aires', () => new Date('2026-02-22').getDate())).toBe(21);
    expect(inTz('Asia/Tokyo', () => new Date('2026-02-22').getDate())).toBe(22);
  });
});

describe.each(ZONES)('local-date parsing in %s (BIZ-11)', (tz) => {
  it.each(DATES)('parseLocalDate(%s) keeps the calendar day and round-trips', (iso) => {
    inTz(tz, () => {
      const d = parseLocalDate(iso)!;
      expect(d).not.toBeNull();
      const [y, m, day] = iso.split('-').map(Number);
      expect(d.getFullYear()).toBe(y);
      expect(d.getMonth()).toBe(m - 1);
      expect(d.getDate()).toBe(day);
      expect(toIsoDate(d)).toBe(iso);
    });
  });

  it('formats 2026-02-22 as Feb 22 (was "Feb 21" in the Americas)', () => {
    inTz(tz, () => {
      expect(formatIsoDate('2026-02-22', { month: 'short', day: 'numeric' })).toBe('Feb 22');
      expect(formatIsoDate('2026-02-22', { weekday: 'short' })).toBe('Sun');
      expect(formatIsoDate('2026-02-22', { day: 'numeric', month: 'short', year: 'numeric' })).toBe('Feb 22, 2026');
    });
  });

  it('generates a 31-day Japan trip range with no duplicates or gaps', () => {
    inTz(tz, () => {
      const range = eachDateInRange('2026-02-22', '2026-03-24');
      expect(range).toHaveLength(31);
      expect(new Set(range).size).toBe(31);
      expect(range[0]).toBe('2026-02-22');
      expect(range[7]).toBe('2026-03-01');
      expect(range[30]).toBe('2026-03-24');
    });
  });

  it('steps across every DST change of 2026 one calendar day at a time', () => {
    inTz(tz, () => {
      const range = eachDateInRange('2026-01-01', '2026-12-31');
      expect(range).toHaveLength(365);
      for (let i = 1; i < range.length; i++) {
        expect(daysBetween(range[i - 1], range[i])).toBe(1);
      }
    });
  });

  it('dashboard/adapter range label shows the stored days', () => {
    inTz(tz, () => {
      const dest = {
        id: '1', trip_id: '1', city_name: 'Tokyo', country: 'Japan',
        start_date: '2026-02-22', end_date: '2026-03-01',
        lat: 35.68, lng: 139.76, zoom_level: 12, order_index: 0, days: [],
      } as ApiDestination;
      expect(apiDestinationToCityData(dest).dates).toBe('Feb 22, 2026 – Mar 1, 2026');
    });
  });

  it('utils.formatDate keeps date-only strings on their day', () => {
    inTz(tz, () => {
      expect(formatDate('2026-02-22')).toBe('Feb 22');
    });
  });
});

describe('parseLocalDate / isIsoDate rejects bad input', () => {
  it.each([
    null,
    undefined,
    '',
    ' 2026-02-22',
    '2026-02-22 ',
    '2026-02-30',
    '2026-02-29', // not a leap year
    '2026-13-01',
    '2026-00-10',
    '2026-02-00',
    '2026-2-22',
    '26-02-22',
    '22/02/2026',
    '2026-02-22T00:00:00Z',
    'null',
    'NaN',
    'undefined',
    'Invalid Date',
  ])('%j → null', (value) => {
    expect(parseLocalDate(value as string | null | undefined)).toBeNull();
    expect(isIsoDate(value as string | null | undefined)).toBe(false);
    expect(formatIsoDate(value as string | null | undefined, { day: 'numeric' })).toBe('');
  });

  it('accepts a real leap day', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
  });
});

describe('calendar arithmetic', () => {
  it.each([
    ['2026-02-28', 1, '2026-03-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-03-07', 2, '2026-03-09'], // across US DST
    ['2026-02-22', 0, '2026-02-22'],
    ['2026-02-22', 365, '2027-02-22'],
  ])('addDays(%s, %i) = %s', (iso, n, expected) => {
    for (const tz of ZONES) expect(inTz(tz, () => addDays(iso, n))).toBe(expected);
  });

  it('addDays rejects invalid input', () => {
    expect(addDays('nope', 1)).toBeNull();
    expect(addDays('2026-02-22', 1.5)).toBeNull();
    expect(addDays('2026-02-22', NaN)).toBeNull();
  });

  it('daysBetween', () => {
    expect(daysBetween('2026-02-22', '2026-03-24')).toBe(30);
    expect(daysBetween('2026-03-24', '2026-02-22')).toBe(-30);
    expect(daysBetween('2026-02-22', '2026-02-22')).toBe(0);
    expect(daysBetween('2026-02-22', 'bad')).toBeNull();
  });

  it('eachDateInRange edge cases', () => {
    expect(eachDateInRange('2026-02-22', '2026-02-22')).toEqual(['2026-02-22']); // equal dates
    expect(eachDateInRange('2026-02-23', '2026-02-22')).toEqual([]); // start > end
    expect(eachDateInRange('bad', '2026-02-22')).toEqual([]);
    expect(eachDateInRange('2026-02-22', '')).toEqual([]);
    expect(eachDateInRange('2028-02-27', '2028-03-01')).toEqual([
      '2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01',
    ]);
    expect(eachDateInRange('2026-01-01', '2026-01-10', 10)).toHaveLength(10);
    expect(() => eachDateInRange('2026-01-01', '2026-01-11', 10)).toThrow(RangeError);
    expect(() => eachDateInRange('2026-01-01', '9999-12-31')).toThrow(RangeError);
  });
});

describe('search subtitles use the local calendar day (BIZ-11)', () => {
  it('destination subtitle and day label in Buenos Aires', () => {
    inTz('America/Argentina/Buenos_Aires', () => {
      const trip = {
        id: 'tz-trip', user_id: '1', name: 'TZ Trip', description: null,
        start_date: '2026-02-22', end_date: '2026-02-23', cover_image_url: null,
        is_public: false, public_slug: null,
        destinations: [{
          id: 'tz-dest', trip_id: 'tz-trip', city_name: 'Zzyzxville', country: 'Japan',
          start_date: '2026-02-22', end_date: '2026-02-23', lat: 35, lng: 139,
          zoom_level: 12, order_index: 0,
          days: [{
            id: 'tz-day', date: '2026-02-22', label: 'Qwertyday', color_hex: '#ff0000',
            order_index: 0, activities: [],
          }],
        }],
      } as ApiTrip;
      const entries = buildTripEntries(trip);
      const city = searchEntries(entries, 'Zzyzxville').find((r) => r.type === 'city');
      expect(city?.subtitle).toBe('TZ Trip · Feb 22');
      const day = searchEntries(entries, 'Qwertyday').find((r) => r.type === 'day');
      expect(day?.subtitle).toBe('Sunday, February 22');
    });
  });
});
