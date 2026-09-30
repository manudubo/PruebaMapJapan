import { describe, it, expect } from 'vitest';
import {
  CreateTripSchema,
  UpdateTripSchema,
  CreateActivitySchema,
  UpdateActivitySchema,
  CreateDestinationSchema,
  UpdateDestinationSchema,
  UpsertHotelSchema,
} from './schemas';

// ---------------------------------------------------------------------------
// BIZ-08 / ARCH-05 — lat/lng are finite decimal numbers within range
// ---------------------------------------------------------------------------

const coordinateSchemas = [
  ['CreateActivitySchema', CreateActivitySchema, { name: 'x' }],
  ['UpdateActivitySchema', UpdateActivitySchema, {}],
  ['CreateDestinationSchema', CreateDestinationSchema, { city_name: 'Tokyo', country: 'Japan' }],
  ['UpdateDestinationSchema', UpdateDestinationSchema, {}],
  ['UpsertHotelSchema', UpsertHotelSchema, { name: 'Hotel' }],
] as const;

describe.each(coordinateSchemas)('%s coordinates (BIZ-08)', (_name, schema, base) => {
  const parse = (coords: Record<string, unknown>) => schema.safeParse({ ...base, ...coords });

  it.each([
    [90, 180],
    [-90, -180],
    [0, 0],
    [35.6762, 139.6503],
    ['90', '180'],
    ['-90.0', '-180.0'],
    [' 35.6762 ', '139.6503'],
    ['+35.5', '.5'],
  ])('accepts in-range lat=%s lng=%s', (lat, lng) => {
    const result = parse({ lat, lng });
    expect(result.success).toBe(true);
  });

  it('normalises coordinates to strings for the numeric DB columns', () => {
    const result = parse({ lat: 35.5, lng: ' 139.25 ' });
    expect(result.success && result.data).toMatchObject({ lat: '35.5', lng: '139.25' });
  });

  it.each([
    ['lat', 90.0000001],
    ['lat', -90.0000001],
    ['lat', 91],
    ['lat', '999'],
    ['lng', 180.0000001],
    ['lng', -180.0000001],
    ['lng', '181'],
  ])('rejects out-of-range %s=%s', (axis, value) => {
    const result = parse({ [axis]: value });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([axis]);
      expect(result.error.issues[0].message).toMatch(/between/);
    }
  });

  it.each([
    'null',
    'NaN',
    'undefined',
    '',
    '   ',
    'abc',
    '35,5',
    '0x10',
    '1e2',
    'Infinity',
    '-Infinity',
  ])('rejects non-decimal string %j', (value) => {
    expect(parse({ lat: value }).success).toBe(false);
    expect(parse({ lng: value }).success).toBe(false);
  });

  it.each([Infinity, -Infinity, NaN])('rejects non-finite number %s', (value) => {
    expect(parse({ lat: value }).success).toBe(false);
  });

  it.each([true, {}, []])('rejects non-number, non-string %j', (value) => {
    expect(parse({ lat: value }).success).toBe(false);
  });

  it('accepts null (coordinates cleared) and omitted coordinates', () => {
    expect(parse({ lat: null, lng: null }).success).toBe(true);
    const omitted = parse({});
    // Update schemas may reject an empty body (BIZ-09) — that is covered
    // separately; here only the coordinate fields must not be the cause.
    if (!omitted.success) {
      expect(omitted.error.issues.every((i) => i.path[0] !== 'lat' && i.path[0] !== 'lng')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// BIZ-06 / ARCH-05 — start ≤ end, null-safe
// ---------------------------------------------------------------------------

const dateRangeSchemas = [
  ['CreateTripSchema', CreateTripSchema, { name: 'Trip' }, 'start_date', 'end_date'],
  ['UpdateTripSchema', UpdateTripSchema, { name: 'Trip' }, 'start_date', 'end_date'],
  ['CreateDestinationSchema', CreateDestinationSchema, { city_name: 'Kyoto', country: 'Japan' }, 'start_date', 'end_date'],
  ['UpdateDestinationSchema', UpdateDestinationSchema, { city_name: 'Kyoto' }, 'start_date', 'end_date'],
  ['UpsertHotelSchema', UpsertHotelSchema, { name: 'Hotel' }, 'check_in_date', 'check_out_date'],
] as const;

describe.each(dateRangeSchemas)('%s date order (BIZ-06)', (_name, schema, base, startKey, endKey) => {
  const parse = (start: unknown, end: unknown) => {
    const body: Record<string, unknown> = { ...base };
    if (start !== undefined) body[startKey] = start;
    if (end !== undefined) body[endKey] = end;
    return schema.safeParse(body);
  };

  it('accepts start before end', () => {
    expect(parse('2026-02-22', '2026-03-24').success).toBe(true);
  });

  it('accepts equal dates (single-day range)', () => {
    expect(parse('2026-02-22', '2026-02-22').success).toBe(true);
  });

  it('rejects start after end, reporting on the end field', () => {
    const result = parse('2026-03-24', '2026-02-22');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].path).toEqual([endKey]);
      expect(result.error.issues[0].message).toBe(`${endKey} must be on or after ${startKey}`);
    }
  });

  it('rejects a one-day inversion across a month boundary', () => {
    expect(parse('2026-03-01', '2026-02-28').success).toBe(false);
  });

  it('rejects a one-day inversion across a year boundary', () => {
    expect(parse('2027-01-01', '2026-12-31').success).toBe(false);
  });

  it('accepts a range across a DST change (calendar comparison, no Date parsing)', () => {
    // Europe/US/Chile/NZ DST switches happen in these windows.
    expect(parse('2026-03-28', '2026-03-30').success).toBe(true);
    expect(parse('2026-04-04', '2026-04-06').success).toBe(true);
    expect(parse('2026-09-26', '2026-09-28').success).toBe(true);
  });

  it.each([
    ['start only', '2026-02-22', undefined],
    ['end only', undefined, '2026-02-22'],
    ['start null, end set', null, '2026-02-22'],
    ['start set, end null', '2026-02-22', null],
    ['both null', null, null],
    ['both omitted', undefined, undefined],
  ])('is null-safe: %s is valid', (_label, start, end) => {
    expect(parse(start, end).success).toBe(true);
  });

  it.each([
    ['2026-02-30'],
    ['2026-13-01'],
    ['2026-2-22'],
    ['22/02/2026'],
    ['2026-02-22T00:00:00Z'],
    [''],
    ['null'],
  ])('rejects malformed date %j', (bad) => {
    expect(parse(bad, '2026-12-31').success).toBe(false);
    expect(parse('2026-01-01', bad).success).toBe(false);
  });

  it('accepts a leap day and rejects a non-leap Feb 29', () => {
    expect(parse('2028-02-29', '2028-03-01').success).toBe(true);
    expect(parse('2026-02-29', '2026-03-01').success).toBe(false);
  });
});
