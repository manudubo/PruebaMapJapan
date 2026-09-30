import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field helpers
// ---------------------------------------------------------------------------

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
    const text = typeof raw === 'string' ? raw.trim() : String(raw);
    const value = typeof raw === 'number' ? raw : DECIMAL_RE.test(text) ? Number(text) : NaN;
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
    return text;
  });
}

/**
 * An absolute http(s) URL. z.string().url() alone also accepts
 * `javascript:`/`data:` URLs, and these values end up as link hrefs.
 */
const httpUrl = z
  .string()
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
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
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
  city_name: z.string().min(1).max(255),
  country: z.string().min(1).max(100),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  lat: coordinate('lat').nullable().optional(),
  lng: coordinate('lng').nullable().optional(),
  zoom_level: z.number().int().min(1).max(20).nullable().optional(),
  order_index: z.number().int().min(0).optional(),
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
  date: z.string().date(),
  label: z.string().max(255).nullable().optional(),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'color_hex must be a valid 6-digit hex color')
    .nullable()
    .optional(),
  order_index: z.number().int().min(0).optional(),
});

export const UpdateDaySchema = CreateDaySchema.partial().superRefine(atLeastOneField);

// ---------------------------------------------------------------------------
// Activity schemas
// ---------------------------------------------------------------------------

export const CreateActivitySchema = z.object({
  name: z.string().min(1).max(255),
  lat: coordinate('lat').nullable().optional(),
  lng: coordinate('lng').nullable().optional(),
  notes: z.string().nullable().optional(),
  is_optional: z.boolean().optional(),
  is_generic: z.boolean().optional(),
  maps_url: httpUrl.nullable().optional(),
  order_index: z.number().int().min(0).optional(),
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
    name: z.string().min(1).max(255),
    lat: coordinate('lat').nullable().optional(),
    lng: coordinate('lng').nullable().optional(),
    check_in_date: z.string().date().nullable().optional(),
    check_out_date: z.string().date().nullable().optional(),
    url: httpUrl.nullable().optional(),
  })
  .superRefine(dateOrder('check_in_date', 'check_out_date'));

// ---------------------------------------------------------------------------
// User schemas
// ---------------------------------------------------------------------------

export const UpdateUserSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    avatar_url: httpUrl.nullable().optional(),
    preferences: z.record(z.unknown()).optional(),
  })
  .superRefine(atLeastOneField);

// ---------------------------------------------------------------------------
// OTP schemas
// ---------------------------------------------------------------------------

export const OtpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'code must be 6 digits'),
});
