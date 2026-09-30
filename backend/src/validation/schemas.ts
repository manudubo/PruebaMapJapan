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
 * Absolute http(s) URL. z.string().url() alone also accepts javascript:,
 * data:, vbscript: and file: URLs, which become stored XSS once a view
 * renders the value as a link or image (public trips are shared).
 */
const httpUrl = () =>
  text()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'URL must use http or https');

// ---------------------------------------------------------------------------
// Trip schemas
// ---------------------------------------------------------------------------

export const CreateTripSchema = z.object({
  name: text().min(1).max(255),
  description: text().nullable().optional(),
  start_date: isoDate().nullable().optional(),
  end_date: isoDate().nullable().optional(),
  cover_image_url: httpUrl().nullable().optional(),
  is_public: z.boolean().optional().default(false),
});

export const UpdateTripSchema = CreateTripSchema.partial();

// ---------------------------------------------------------------------------
// Destination schemas
// ---------------------------------------------------------------------------

export const CreateDestinationSchema = z.object({
  city_name: text().min(1).max(255),
  country: text().min(1).max(100),
  start_date: isoDate().nullable().optional(),
  end_date: isoDate().nullable().optional(),
  lat: z.coerce.string().nullable().optional(),
  lng: z.coerce.string().nullable().optional(),
  zoom_level: z.number().int().min(1).max(20).nullable().optional(),
  order_index: orderIndex().optional(),
});

export const UpdateDestinationSchema = CreateDestinationSchema.partial();

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

export const UpdateDaySchema = CreateDaySchema.partial();

// ---------------------------------------------------------------------------
// Activity schemas
// ---------------------------------------------------------------------------

export const CreateActivitySchema = z.object({
  name: text().min(1).max(255),
  lat: z.coerce.string().nullable().optional(),
  lng: z.coerce.string().nullable().optional(),
  notes: text().nullable().optional(),
  is_optional: z.boolean().optional(),
  maps_url: httpUrl().nullable().optional(),
  order_index: orderIndex().optional(),
  time: text().nullable().optional(),
});

export const UpdateActivitySchema = CreateActivitySchema.partial();

export const ReorderActivitiesSchema = z.object({
  ordered_ids: z.array(z.number().int().positive()),
});

// ---------------------------------------------------------------------------
// Hotel schema
// ---------------------------------------------------------------------------

export const UpsertHotelSchema = z.object({
  name: text().min(1).max(255),
  lat: z.coerce.string().nullable().optional(),
  lng: z.coerce.string().nullable().optional(),
  check_in_date: isoDate().nullable().optional(),
  check_out_date: isoDate().nullable().optional(),
  url: httpUrl().nullable().optional(),
});

// ---------------------------------------------------------------------------
// User schemas
// ---------------------------------------------------------------------------

export const UpdateUserSchema = z.object({
  name: text().min(1).max(255).optional(),
  avatar_url: httpUrl().nullable().optional(),
  preferences: z
    .record(z.unknown())
    .refine((p) => !containsNul(p), 'must not contain NUL characters')
    .optional(),
});

// ---------------------------------------------------------------------------
// OTP schemas
// ---------------------------------------------------------------------------

export const OtpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'code must be 6 digits'),
});
