import { describe, it, expect } from 'vitest';
import {
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
