import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field helpers
// ---------------------------------------------------------------------------

/**
 * Free text that Postgres can store. TEXT/VARCHAR/JSONB reject U+0000, so
 * a NUL used to reach the INSERT and come back as a 500.
 */
const text = () => z.string().regex(/^[^\u0000]*$/, 'must not contain NUL characters');

/** True if any string or key anywhere inside `value` contains U+0000. */
function containsNul(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (v.includes('\u0000')) return true;
    } else if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (k.includes('\u0000')) return true;
        stack.push(child);
      }
    }
  }
  return false;
}

/**
 * ISO calendar date (YYYY-MM-DD) that Postgres can store. zod's .date()
 * accepts year 0000 (e.g. "0000-02-29"), which Postgres rejects with a 500.
 */
const isoDate = () =>
  z
    .string()
    .date()
    .refine((d) => !d.startsWith('0000-'), 'year must be 0001 or later');

/** order_index column is int4: larger values failed at INSERT with a 500. */
const orderIndex = () => z.number().int().min(0).max(2_147_483_647);

/**
 * preferences is free-form JSON stored in JSONB. Unbounded nesting blew the
 * stack in JSON.stringify (500), and size was bounded only by the body cap.
 */
const PREFERENCES_MAX_DEPTH = 32;
const PREFERENCES_MAX_CHARS = 16 * 1024;

/** Nesting depth of a parsed JSON value, computed without recursion. */
function jsonDepth(value: unknown): number {
  let max = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    max = Math.max(max, depth);
    if (max > PREFERENCES_MAX_DEPTH) return max;
    for (const child of Object.values(v)) stack.push([child, depth + 1]);
  }
  return max;
}

/**
 * Why `preferences` cannot be stored, or null. Checks run in order and stop
 * at the first failure: depth first, so JSON.stringify never sees a value
 * deep enough to overflow the stack.
 */
function preferencesProblem(p: unknown): string | null {
  if (jsonDepth(p) > PREFERENCES_MAX_DEPTH) return `must be nested at most ${PREFERENCES_MAX_DEPTH} levels`;
  if (JSON.stringify(p).length > PREFERENCES_MAX_CHARS) return `must serialise to at most ${PREFERENCES_MAX_CHARS} characters`;
  if (containsNul(p)) return 'must not contain NUL characters';
  return null;
}

/** Plain decimal notation only: no hex, exponent, "NaN", "Infinity" or blanks. */
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * A latitude/longitude value. Accepts a JSON number or a decimal string (the
 * DB `numeric` columns round-trip as strings), rejects non-finite / non-decimal
 * input such as "null", "NaN" or "", and enforces the geographic range.
 * Output is a string because Drizzle expects strings for `numeric` columns.
 */
function coordinate(axis: 'lat' | 'lng') {
  const limit = axis === 'lat' ? 90 : 180;
  return z.union([z.number(), z.string()]).transform((raw, ctx) => {
    const str = typeof raw === 'string' ? raw.trim() : String(raw);
    const value = typeof raw === 'number' ? raw : DECIMAL_RE.test(str) ? Number(str) : NaN;
    if (!Number.isFinite(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${axis} must be a decimal number` });
      return z.NEVER;
    }
    if (value < -limit || value > limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${axis} must be between -${limit} and ${limit}`,
      });
      return z.NEVER;
    }
    return str;
  });
}

/**
 * An absolute http(s) URL. z.string().url() alone also accepts `javascript:`,
 * `data:`, `vbscript:` and `file:` URLs, which become stored XSS once a view
 * renders the value as a link or image (public trips are shared). Built on
 * text() so a NUL cannot reach Postgres either.
 */
const httpUrl = text()
  .url()
  .refine(
    (value) => {
      try {
        return /^https?:$/i.test(new URL(value).protocol);
      } catch {
        return true; // not a URL at all — already reported by .url()
      }
    },
    { message: 'URL must start with http:// or https://' },
  );

/** 24-hour clock time as produced by <input type="time">: HH:MM or HH:MM:SS. */
const clockTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'time must be HH:MM (24-hour)');

/**
 * PATCH bodies must change something (BIZ-09). Unknown keys are already
 * stripped by z.object, so `{}` and `{ unknown: 1 }` both fail here instead of
 * returning 200 having only bumped `updated_at`.
 */
function atLeastOneField(data: Record<string, unknown>, ctx: z.RefinementCtx): void {
  if (!Object.values(data).some((value) => value !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Request body must include at least one field to update',
    });
  }
}

/**
 * Null-safe date-range check (BIZ-06): only compares when both ends are
 * present, so partial-date records stay valid. Dates are already validated
 * as YYYY-MM-DD, so string comparison is calendar order (no Date/timezone
 * parsing involved). Equal dates are allowed (single-day ranges).
 */
function dateOrder<K extends string>(startKey: K, endKey: K) {
  return (data: Partial<Record<K, string | null | undefined>>, ctx: z.RefinementCtx): void => {
    const start = data[startKey];
    const end = data[endKey];
    if (typeof start === 'string' && typeof end === 'string' && start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [endKey],
        message: `${endKey} must be on or after ${startKey}`,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Trip schemas
// ---------------------------------------------------------------------------

const TripFields = z.object({
  name: text().min(1).max(255),
  description: text().nullable().optional(),
  start_date: isoDate().nullable().optional(),
  end_date: isoDate().nullable().optional(),
  cover_image_url: httpUrl.nullable().optional(),
  is_public: z.boolean().optional().default(false),
});

const tripDateOrder = dateOrder('start_date', 'end_date');

export const CreateTripSchema = TripFields.superRefine(tripDateOrder);

export const UpdateTripSchema = TripFields.partial()
  .superRefine(atLeastOneField)
  .superRefine(tripDateOrder);

// ---------------------------------------------------------------------------
// Destination schemas
// ---------------------------------------------------------------------------

const DestinationFields = z.object({
  city_name: text().min(1).max(255),
  country: text().min(1).max(100),
  start_date: isoDate().nullable().optional(),
  end_date: isoDate().nullable().optional(),
  lat: coordinate('lat').nullable().optional(),
  lng: coordinate('lng').nullable().optional(),
  zoom_level: z.number().int().min(1).max(20).nullable().optional(),
  order_index: orderIndex().optional(),
});

const destinationDateOrder = dateOrder('start_date', 'end_date');

export const CreateDestinationSchema = DestinationFields.superRefine(destinationDateOrder);

export const UpdateDestinationSchema = DestinationFields.partial()
  .superRefine(atLeastOneField)
  .superRefine(destinationDateOrder);

// ---------------------------------------------------------------------------
// Day schemas
// ---------------------------------------------------------------------------

export const CreateDaySchema = z.object({
  date: isoDate(),
  label: text().max(255).nullable().optional(),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'color_hex must be a valid 6-digit hex color')
    .nullable()
    .optional(),
  order_index: orderIndex().optional(),
});

export const UpdateDaySchema = CreateDaySchema.partial().superRefine(atLeastOneField);

// ---------------------------------------------------------------------------
// Activity schemas
// ---------------------------------------------------------------------------

export const CreateActivitySchema = z.object({
  name: text().min(1).max(255),
  lat: coordinate('lat').nullable().optional(),
  lng: coordinate('lng').nullable().optional(),
  notes: text().nullable().optional(),
  is_optional: z.boolean().optional(),
  is_generic: z.boolean().optional(),
  maps_url: httpUrl.nullable().optional(),
  order_index: orderIndex().optional(),
  time: clockTime.nullable().optional(),
});

export const UpdateActivitySchema = CreateActivitySchema.partial().superRefine(atLeastOneField);

export const ReorderActivitiesSchema = z.object({
  ordered_ids: z.array(z.number().int().positive()),
});

// ---------------------------------------------------------------------------
// Hotel schema
// ---------------------------------------------------------------------------

export const UpsertHotelSchema = z
  .object({
    name: text().min(1).max(255),
    lat: coordinate('lat').nullable().optional(),
    lng: coordinate('lng').nullable().optional(),
    check_in_date: isoDate().nullable().optional(),
    check_out_date: isoDate().nullable().optional(),
    url: httpUrl.nullable().optional(),
  })
  .superRefine(dateOrder('check_in_date', 'check_out_date'));

// ---------------------------------------------------------------------------
// User schemas
// ---------------------------------------------------------------------------

export const UpdateUserSchema = z
  .object({
    name: text().min(1).max(255).optional(),
    avatar_url: httpUrl.nullable().optional(),
    preferences: z
      .record(z.unknown())
      .superRefine((p, ctx) => {
        const problem = preferencesProblem(p);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      })
      .optional(),
  })
  .superRefine(atLeastOneField);

// ---------------------------------------------------------------------------
// OTP schemas
// ---------------------------------------------------------------------------

export const OtpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'code must be 6 digits'),
});
