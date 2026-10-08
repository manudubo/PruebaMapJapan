import type { users, trips, destinations, hotels, days, activities } from '../db/schema';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { Db } from '../db';

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
  /** "neon" (HTTP, default on Workers) | "pg" (TCP, Node dev/seed/tests) — ARCH-02 */
  DB_DRIVER?: string;
  KEYCLOAK_URL: string;
  KEYCLOAK_REALM: string;
  VALID_AUDIENCES: string;        // comma-separated, e.g. "japan-trip-frontend"
  KC_ADMIN_CLIENT_ID: string;     // D-03: worker client credentials
  KC_ADMIN_CLIENT_SECRET: string; // D-03: worker client credentials
  OTP_SECRET: string;             // HMAC-SHA256 key for OTP hashing (D-07)
  RESEND_API_KEY?: string;        // one email provider is required unless ENVIRONMENT=development (SEC-08)
  /** resend | smtp (default: resend if RESEND_API_KEY, else smtp if SMTP_HOST). See auth/otp-email.ts. */
  EMAIL_PROVIDER?: string;
  /** From address for OTP mail, "addr" or "Name <addr>" (SMTP_FROM is an alias). */
  EMAIL_FROM?: string;
  SMTP_FROM?: string;
  SMTP_HOST?: string;
  /** default 587 */
  SMTP_PORT?: string;
  /** starttls (default) | tls | none (development only) */
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  /** Public issuer override (default `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`). */
  KEYCLOAK_ISSUER?: string;
  /** Where to fetch signing keys (default derived from KEYCLOAK_URL); may be an internal URL. */
  KEYCLOAK_JWKS_URL?: string;
  /** Comma-separated client ids allowed as `azp` (default: VALID_AUDIENCES). */
  ALLOWED_AZP?: string;
  /** "development" enables localhost CORS + Mailpit; anything else = production (fail-closed). */
  ENVIRONMENT?: string;
  /**
   * Comma-separated exact browser origins allowed by CORS (SEC-23). Unset:
   * the Pages origin from config/deploy-defaults.json. Empty: none.
   */
  ALLOWED_ORIGINS?: string;
  /** Proxies in front of the app (default 0 = trust no forwarding header). See middleware/client-ip.ts. */
  TRUSTED_PROXY_HOPS?: string;
  /** x-forwarded-for (default) | x-real-ip | cf-connecting-ip; read only when TRUSTED_PROXY_HOPS > 0. */
  CLIENT_IP_HEADER?: string;
  /** Contact (email or URL) for the Nominatim User-Agent; required outside development (SEC-18). */
  NOMINATIM_CONTACT?: string;
  /** Product token(s) for the Nominatim User-Agent (default TravelMap-PruebaMapJapan/1.0). */
  NOMINATIM_USER_AGENT?: string;
  /** Upstream search endpoint (default https://nominatim.openstreetmap.org/search). */
  NOMINATIM_URL?: string;
}

// ---------------------------------------------------------------------------
// Auth — decoded JWT payload from Keycloak
// ---------------------------------------------------------------------------
export interface KeycloakJwtPayload {
  sub: string;
  iss: string;
  aud?: string | string[];
  /** Keycloak token type claim: "Bearer" for access tokens, "ID" for ID tokens. */
  typ?: string;
  /** Authorized party: the client the token was issued to. */
  azp?: string;
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
  /** Typed database handle — set by dbMiddleware (M-01) */
  db: Db;
  /** Server-generated id of this request (X-Request-Id, every log line). */
  requestId: string;
}

// ---------------------------------------------------------------------------
// Generic API response shape
// ---------------------------------------------------------------------------
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  message?: string;
}
