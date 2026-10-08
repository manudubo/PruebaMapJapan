import { Hono, type Context } from 'hono';
import { zValidator } from '../validation/validator';
import { dbMiddleware } from '../middleware/db';
import { POLICIES, rateLimit } from '../middleware/rate-limit';
import { getUserByEmail, markEmailVerified } from '../db';
import { consumeOtpAttempt, getLatestUnexpiredOtp, releaseOtp } from '../db/queries/otp';
import { checkOtp, issueAndSendOtp, timingSafeCompare } from '../auth/otp-core';
import { passwordProblem } from '../auth/password-policy';
import { KeycloakAdminError, recoveryClientConfig, resetKeycloakPassword } from '../auth/keycloak-admin';
import { RecoveryConfirmSchema, RecoveryRequestSchema } from '../validation/schemas';
import { log } from '../observability/logger';
import type { ApiResponse, ContextVariables, Env } from '../types';

/**
 * Account recovery for passkey-only users on a device without passkey
 * support: an e-mail code proves ownership of the address, then the backend
 * sets a new password in Keycloak through the Admin API.
 *
 *   POST /api/auth/recovery/request  { email }
 *   POST /api/auth/recovery/confirm  { email, code, new_password }
 *
 * Both are unauthenticated, so the design goal is that nothing observable
 * depends on whether an account exists:
 *
 *  - request: the same 202 body for every well-formed address. The lookup is
 *    the only work done before answering; issuing and mailing the code run in
 *    the background (waitUntil on Workers) for an existing account and not at
 *    all otherwise, so latency cannot tell them apart.
 *  - confirm: every failure of the code check (no such account, no pending
 *    code, wrong code, burned code) is the same 400 `invalid_code`, and the
 *    unknown-account path does the same database and HMAC work as a wrong
 *    guess on a real account.
 *  - rate limits are keyed by IP, by the (normalised) address in the body and
 *    by a global bucket, none of which depends on the account.
 * The password policy runs first and needs no account, so a typo does not
 * burn a guess and reveals nothing.
 */
const recovery = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

const GENERIC_REQUEST_MESSAGE = 'If an account exists for that address, a recovery code has been sent.';

// Per-IP first: a flood is refused before the body is parsed or the DB touched.
recovery.use('/request', rateLimit(POLICIES.recoveryRequestPerIp));
recovery.use('/confirm', rateLimit(POLICIES.recoveryConfirmPerIp));
recovery.use('*', dbMiddleware);

/** Sent when recovery is switched off or Keycloak cannot be used right now. */
function tryAgainLater(c: Context) {
  c.header('Cache-Control', 'no-store');
  const body: ApiResponse<never> = { success: false, error: 'try_again_later', code: 'service_unavailable' };
  return c.json(body, 503);
}

// ---------------------------------------------------------------------------
// Background work (code issuing + mail)
// ---------------------------------------------------------------------------

const background = new Set<Promise<void>>();

function runInBackground(c: Context, task: () => Promise<void>): void {
  const p: Promise<void> = task()
    .catch((err: unknown) => {
      // Scrubbed by the logger (no address, no code). The caller already got
      // the generic answer, which is the point.
      log.error('recovery.background_failed', { error: err });
    })
    .finally(() => {
      background.delete(p);
    });
  background.add(p);
  try {
    c.executionCtx.waitUntil(p);
  } catch {
    // Not on Workers (Node server, tests): the promise runs on its own.
  }
}

/** Test hook: resolves when every in-flight recovery mail has been handled. */
export async function __settleRecoveryBackgroundForTests(): Promise<void> {
  while (background.size > 0) await Promise.allSettled([...background]);
}

// ---------------------------------------------------------------------------
// POST /api/auth/recovery/request
// ---------------------------------------------------------------------------

recovery.post(
  '/request',
  zValidator('json', RecoveryRequestSchema),
  rateLimit(POLICIES.recoveryRequestPerEmail, POLICIES.recoveryRequestGlobal),
  async (c) => {
    // Configuration, not account state: safe to reveal. No secret = nothing
    // could be recovered with a code, so none is sent.
    if (!recoveryClientConfig(c.env)) {
      log.error('recovery.not_configured', { request_id: c.get('requestId') });
      return tryAgainLater(c);
    }

    const { email } = c.req.valid('json');
    const db = c.get('db');
    const user = await getUserByEmail(db, email);

    if (user) {
      runInBackground(c, async () => {
        // A pending code or the hourly cap just means "no new mail"; the
        // caller is never told.
        await issueAndSendOtp(db, c.env, {
          userId: user.id,
          email: user.email,
          purpose: 'recovery',
          requestId: c.get('requestId'),
        });
      });
    }

    c.header('Cache-Control', 'no-store');
    return c.json({ success: true as const, message: GENERIC_REQUEST_MESSAGE }, 202);
  },
);

// ---------------------------------------------------------------------------
// POST /api/auth/recovery/confirm
// ---------------------------------------------------------------------------

/** A well-formed hash no code maps to: the unknown-account path compares against it. */
const DECOY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const invalidCode = (c: Context) => {
  c.header('Cache-Control', 'no-store');
  const body: ApiResponse<never> = { success: false, error: 'invalid_code' };
  return c.json(body, 400);
};

recovery.post(
  '/confirm',
  zValidator('json', RecoveryConfirmSchema),
  rateLimit(POLICIES.recoveryConfirmPerEmail, POLICIES.recoveryConfirmGlobal),
  async (c) => {
    const { email, code, new_password: password } = c.req.valid('json');

    // 1. Password policy: no account, no state, no Keycloak.
    const problem = passwordProblem(password, email);
    if (problem) {
      c.header('Cache-Control', 'no-store');
      return c.json({ success: false as const, error: 'weak_password', code: 'weak_password', reason: problem }, 422);
    }

    if (!recoveryClientConfig(c.env)) {
      log.error('recovery.not_configured', { request_id: c.get('requestId') });
      return tryAgainLater(c);
    }

    const db = c.get('db');
    const user = await getUserByEmail(db, email);

    // 2. Unknown account: spend what a wrong guess on a real one spends
    //    (pending-code read, attempt update, HMAC compare), answer the same.
    if (!user) {
      await getLatestUnexpiredOtp(db, 0, 'recovery');
      await consumeOtpAttempt(db, 0);
      await timingSafeCompare(code, DECOY_HASH, c.env.OTP_SECRET);
      return invalidCode(c);
    }

    // 3. The code: atomic attempt cap, single use, constant-time compare.
    //    Every failure is the same answer (see the header comment).
    const check = await checkOtp(db, c.env, user.id, 'recovery', code);
    if (check.status !== 'ok') return invalidCode(c);

    // 4. This request now owns the code: set the password. Of N parallel
    //    confirms with the right code exactly one reaches this line.
    try {
      await resetKeycloakPassword(c.env, user.email, password, {
        // Never proved the address (squatting): drop passkeys + sessions too.
        purgeOtherCredentials: user.email_verified_at === null,
      });
    } catch (err) {
      if (!(err instanceof KeycloakAdminError)) {
        await releaseOtp(db, check.otpId).catch(() => {});
        throw err;
      }
      c.header('Cache-Control', 'no-store');
      if (err.kind === 'user_not_found' || err.kind === 'ambiguous') {
        // The code is spent: retrying cannot help. Operator-visible in the log.
        log.error('recovery.account_not_resettable', { request_id: c.get('requestId'), kind: err.kind });
        const body: ApiResponse<never> = { success: false, error: 'recovery_unavailable', code: 'recovery_unavailable' };
        return c.json(body, 422);
      }
      // The failure was not the user's: give the code back so they can retry.
      await releaseOtp(db, check.otpId).catch(() => {});
      if (err.kind === 'rejected') {
        return c.json({ success: false as const, error: 'weak_password', code: 'weak_password', reason: 'rejected' }, 422);
      }
      return tryAgainLater(c);
    }

    // Controlling the mailbox is the proof the sign-up flow asks for.
    await markEmailVerified(db, user.id);

    c.header('Cache-Control', 'no-store');
    const body: ApiResponse<never> = { success: true };
    return c.json(body, 200);
  },
);

export default recovery;
