import type { users, trips, destinations, hotels, days, activities } from '../db/schema';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Inferred row types from Drizzle schema
// ---------------------------------------------------------------------------
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Trip = InferSelectModel<typeof trips>;
export type NewTrip = InferInsertModel<typeof trips>;

export type Destination = InferSelectModel<typeof destinations>;
export type NewDestination = InferInsertModel<typeof destinations>;

export type Hotel = InferSelectModel<typeof hotels>;
export type NewHotel = InferInsertModel<typeof hotels>;

export type Day = InferSelectModel<typeof days>;
export type NewDay = InferInsertModel<typeof days>;

export type Activity = InferSelectModel<typeof activities>;
export type NewActivity = InferInsertModel<typeof activities>;

// ---------------------------------------------------------------------------
// Cloudflare Workers environment bindings
// ---------------------------------------------------------------------------
export interface Env {
  DATABASE_URL: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  VALID_AUDIENCES: string;        // comma-separated, e.g. "japan-trip-frontend"
  KC_ADMIN_CLIENT_ID: string;     // D-03: worker client credentials
  KC_ADMIN_CLIENT_SECRET: string; // D-03: worker client credentials
}

// ---------------------------------------------------------------------------
// Auth — decoded JWT payload from Keycloak
// ---------------------------------------------------------------------------
export interface KeycloakJwtPayload {
  sub: string;
  iss: string;
  aud?: string | string[];
  email?: string;
  name: string;
  preferred_username: string;
  email_verified: boolean;
  realm_access?: {
    roles: string[];
  };
  iat: number;
  exp: number;
  nbf?: number;
}

// ---------------------------------------------------------------------------
// Hono context variable map (set by auth middleware + ensureUserProvisioned)
// ---------------------------------------------------------------------------
export interface ContextVariables {
  user: KeycloakJwtPayload;
  /** DB primary key for the authenticated user — set by ensureUserProvisioned */
  dbUserId: number;
}

// ---------------------------------------------------------------------------
// Generic API response shape
// ---------------------------------------------------------------------------
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
