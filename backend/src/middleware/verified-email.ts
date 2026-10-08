import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { checkSchemaReady, SCHEMA_NOT_MIGRATED } from '../db/schema-guard';
import { dbFromEnv } from './db';
import { verifiedEmailRequired } from '../config/verified-email';
import type { ApiResponse, ContextVariables, Env } from '../types';

type Ctx = Context<{ Bindings: Env; Variables: ContextVariables }>;

export const EMAIL_NOT_VERIFIED = 'email_not_verified';

/**
 * Verified = the app row says so (users.email_verified_at, set by the sign-up
 * OTP or account recovery) OR the Keycloak token says so. The token claim must
 * be the boolean `true`: the string "true", a missing claim, 1 and "yes" are
 * all unverified.
 */
export function isEmailVerified(tokenClaim: unknown, verifiedAt: Date | null | undefined): boolean {
  return verifiedAt != null || tokenClaim === true;
}

/**
 * Gate for authenticated routes (REQUIRE_VERIFIED_EMAIL, default on in
 * production): an account that has not proven its address gets
 * 403 {error, code:'email_not_verified'} and nothing else runs. Mounted on
 * every authenticated router EXCEPT the e-mail verification endpoints and
 * GET/PATCH /api/users/me, which the unverified user needs to finish sign-up
 * (tests/adversarial/email-verification.test.ts enumerates app.routes, so a
 * new route that forgets the gate fails the build).
 *
 * Mount after authMiddleware. It reads the app row only when the token does
 * not already vouch for the address, reusing the row ensureUserProvisioned
 * loaded when that ran first.
 */
export async function requireVerifiedEmail(c: Ctx, next: Next) {
  if (!verifiedEmailRequired(c.env)) return next();

  const claim = c.get('user').email_verified;
  if (claim === true) return next();

  let verifiedAt = c.get('emailVerifiedAt');
  if (verifiedAt === undefined) {
    const db = c.get('db') ?? dbFromEnv(c.env);
    if (!db) {
      const response: ApiResponse<never> = { success: false, error: 'Server configuration error' };
      return c.json(response, 500);
    }
    const verdict = await checkSchemaReady(db, c.env.DATABASE_URL);
    if (!verdict.ok) {
      const response: ApiResponse<never> = { success: false, error: 'Service unavailable', code: SCHEMA_NOT_MIGRATED };
      return c.json(response, 503);
    }
    const [row] = await db
      .select({ verifiedAt: users.email_verified_at })
      .from(users)
      .where(eq(users.keycloak_id, c.get('user').sub))
      .limit(1);
    verifiedAt = row?.verifiedAt ?? null;
  }

  if (isEmailVerified(claim, verifiedAt)) return next();

  const response: ApiResponse<never> = { success: false, error: EMAIL_NOT_VERIFIED, code: EMAIL_NOT_VERIFIED };
  return c.json(response, 403);
}
