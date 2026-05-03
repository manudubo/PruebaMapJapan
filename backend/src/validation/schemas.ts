import { z } from 'zod';

// ---------------------------------------------------------------------------
// Trip schemas
// ---------------------------------------------------------------------------

export const CreateTripSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
  is_public: z.boolean().optional().default(false),
});

export const UpdateTripSchema = CreateTripSchema.partial();

// ---------------------------------------------------------------------------
// Destination schemas
// ---------------------------------------------------------------------------

export const CreateDestinationSchema = z.object({
  city_name: z.string().min(1).max(255),
  country: z.string().min(1).max(100),
  start_date: z.string().date().nullable().optional(),
  end_date: z.string().date().nullable().optional(),
  lat: z.string().nullable().optional(),
  lng: z.string().nullable().optional(),
  zoom_level: z.number().int().min(1).max(20).nullable().optional(),
  order_index: z.number().int().min(0).optional(),
});

export const UpdateDestinationSchema = CreateDestinationSchema.partial();

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

export const UpdateDaySchema = CreateDaySchema.partial();

// ---------------------------------------------------------------------------
// Activity schemas
// ---------------------------------------------------------------------------

export const CreateActivitySchema = z.object({
  name: z.string().min(1).max(255),
  lat: z.string().nullable().optional(),
  lng: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_optional: z.boolean().optional(),
  maps_url: z.string().url().nullable().optional(),
  order_index: z.number().int().min(0).optional(),
  time: z.string().nullable().optional(),
});

export const UpdateActivitySchema = CreateActivitySchema.partial();

export const ReorderActivitiesSchema = z.object({
  ordered_ids: z.array(z.number().int().positive()),
});

// ---------------------------------------------------------------------------
// Hotel schema
// ---------------------------------------------------------------------------

export const UpsertHotelSchema = z.object({
  name: z.string().min(1).max(255),
  lat: z.string().nullable().optional(),
  lng: z.string().nullable().optional(),
  check_in_date: z.string().date().nullable().optional(),
  check_out_date: z.string().date().nullable().optional(),
  url: z.string().url().nullable().optional(),
});

// ---------------------------------------------------------------------------
// User schemas
// ---------------------------------------------------------------------------

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatar_url: z.string().url().nullable().optional(),
  preferences: z.record(z.unknown()).optional(),
});
