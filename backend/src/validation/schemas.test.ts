import { describe, it, expect } from 'vitest';
import {
  CreateTripSchema,
  UpdateTripSchema,
  CreateActivitySchema,
  UpdateActivitySchema,
  CreateDestinationSchema,
  UpdateDestinationSchema,
  UpsertHotelSchema,
  UpdateDaySchema,
  UpdateUserSchema,
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

// ---------------------------------------------------------------------------
// BIZ-09 / ARCH-05 — PATCH schemas require at least one field
// ---------------------------------------------------------------------------

const patchSchemas = [
  ['UpdateTripSchema', UpdateTripSchema, { name: 'x' }],
  ['UpdateDestinationSchema', UpdateDestinationSchema, { country: 'Japan' }],
  ['UpdateDaySchema', UpdateDaySchema, { label: 'Day 1' }],
  ['UpdateActivitySchema', UpdateActivitySchema, { notes: 'n' }],
  ['UpdateUserSchema', UpdateUserSchema, { name: 'n' }],
] as const;

describe.each(patchSchemas)('%s non-empty (BIZ-09)', (_name, schema, oneField) => {
  it('rejects {}', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Request body must include at least one field to update');
    }
  });

  it('rejects a body whose only keys are unknown (they are stripped)', () => {
    expect(schema.safeParse({ id: 1, created_at: 'x', hacker: true }).success).toBe(false);
  });

  it('rejects a body whose only key is explicitly undefined', () => {
    const key = Object.keys(oneField)[0];
    expect(schema.safeParse({ [key]: undefined }).success).toBe(false);
  });

  it('accepts a single real field', () => {
    expect(schema.safeParse(oneField).success).toBe(true);
  });
});

describe('BIZ-09 edge cases', () => {
  it('null counts as a change (clearing a field)', () => {
    expect(UpdateTripSchema.safeParse({ description: null }).success).toBe(true);
    expect(UpdateActivitySchema.safeParse({ time: null }).success).toBe(true);
  });

  it('false counts as a change', () => {
    expect(UpdateTripSchema.safeParse({ is_public: false }).success).toBe(true);
    expect(UpdateActivitySchema.safeParse({ is_optional: false }).success).toBe(true);
  });

  it('PATCH does not apply the create-time is_public default', () => {
    const result = UpdateTripSchema.safeParse({ name: 'x' });
    expect(result.success && result.data).toEqual({ name: 'x' });
  });

  it('create schemas are not affected by the non-empty rule beyond their required fields', () => {
    expect(CreateTripSchema.safeParse({ name: 'x' }).success).toBe(true);
    expect(CreateTripSchema.safeParse({}).success).toBe(false);
  });

  it('a PATCH with one invalid field reports the field error, not "empty body"', () => {
    const result = UpdateTripSchema.safeParse({ start_date: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['start_date']);
  });
});

// ---------------------------------------------------------------------------
// BIZ-01/02/03/04 — activity fields round-trip through the schema
// ---------------------------------------------------------------------------

describe('activity fields (BIZ-01..04)', () => {
  const full = {
    name: 'Shibuya area',
    lat: '35.6595',
    lng: '139.7005',
    notes: 'Walk around',
    is_optional: true,
    is_generic: true,
    maps_url: 'https://maps.google.com/?q=Shibuya',
    time: '09:30',
    order_index: 2,
  };

  it('keeps every editor field on create (is_generic no longer stripped)', () => {
    const result = CreateActivitySchema.safeParse(full);
    expect(result.success && result.data).toEqual(full);
  });

  it('keeps is_generic on its own in a PATCH', () => {
    const result = UpdateActivitySchema.safeParse({ is_generic: true });
    expect(result.success && result.data).toEqual({ is_generic: true });
  });

  it.each([true, false])('is_optional=%s and is_generic combine freely', (flag) => {
    const result = CreateActivitySchema.safeParse({ name: 'x', is_optional: flag, is_generic: !flag });
    expect(result.success).toBe(true);
  });

  it.each(['yes', 1, 'true', null])('rejects non-boolean is_generic %j', (value) => {
    expect(CreateActivitySchema.safeParse({ name: 'x', is_generic: value }).success).toBe(false);
  });

  it.each(['00:00', '09:05', '23:59', '12:30:15'])('accepts time %j', (time) => {
    expect(CreateActivitySchema.safeParse({ name: 'x', time }).success).toBe(true);
  });

  it.each(['24:00', '9:05', '09:60', '9am', 'morning', '', '09:30:60', '09:30 '])('rejects time %j', (time) => {
    expect(CreateActivitySchema.safeParse({ name: 'x', time }).success).toBe(false);
  });

  it('accepts null time (cleared)', () => {
    expect(UpdateActivitySchema.safeParse({ time: null }).success).toBe(true);
  });
});

describe('URL fields accept only http(s)', () => {
  const urlCases = [
    ['activity maps_url', (url: unknown) => CreateActivitySchema.safeParse({ name: 'x', maps_url: url })],
    ['hotel url', (url: unknown) => UpsertHotelSchema.safeParse({ name: 'x', url })],
    ['trip cover_image_url', (url: unknown) => CreateTripSchema.safeParse({ name: 'x', cover_image_url: url })],
    ['user avatar_url', (url: unknown) => UpdateUserSchema.safeParse({ avatar_url: url })],
  ] as const;

  describe.each(urlCases)('%s', (_label, parse) => {
    it.each([
      'https://www.google.com/maps/place/Senso-ji/@35.7148,139.7967,17z',
      'http://example.com',
      'HTTPS://EXAMPLE.COM/x',
    ])('accepts %s', (url) => {
      expect(parse(url).success).toBe(true);
    });

    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com',
      'www.google.com/maps',
      'not a url',
      '',
    ])('rejects %j', (url) => {
      expect(parse(url).success).toBe(false);
    });

    it('accepts null (cleared)', () => {
      expect(parse(null).success).toBe(true);
    });
  });
});
