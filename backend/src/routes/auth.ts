import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { dbMiddleware } from '../middleware/db';
import { ensureUserProvisioned } from '../middleware/user';
import type { Env, ContextVariables, ApiResponse } from '../types';
import { OtpVerifySchema } from '../validation/schemas';
import { checkOtp, issueAndSendOtp } from '../auth/otp-core';
import { POLICIES, rateLimit } from '../middleware/rate-limit';

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const authRoute = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

// Per-IP limits run before the token is verified, so a flood is rejected
// without JWT/DB work; per-user limits run after authentication.
authRoute.use('/otp-request', rateLimit(POLICIES.otpRequestPerIp));
authRoute.use('/otp-verify', rateLimit(POLICIES.otpVerifyPerIp));
authRoute.use('*', authMiddleware, dbMiddleware, ensureUserProvisioned);

// Unexpected failures propagate to the global errorHandler (M-09), which logs
// them and answers a generic 500.

// POST /api/auth/otp-request
// No request body — email is taken from c.var.user.email
authRoute.post('/otp-request', rateLimit(POLICIES.otpRequestPerUser), async (c) => {
  const { email, email_verified: emailVerified } = c.get('user');
  if (!email) {
    const response: ApiResponse<never> = { success: false, error: 'no_email' };
    return c.json(response, 422);
  }
  // The code only ever goes to the account's own address, and only once
  // Keycloak has verified it: otherwise anyone could register an account
  // with a stranger's address and use our mailbox to spam it.
  if (emailVerified !== true) {
    const response: ApiResponse<never> = { success: false, error: 'email_not_verified' };
    return c.json(response, 422);
  }

  const issued = await issueAndSendOtp(c.get('db'), c.env, {
    userId: c.get('dbUserId'),
    email,
    purpose: 'login',
    requestId: c.get('requestId'),
  });
  if (issued.status !== 'sent') {
    return c.json(
      { success: false as const, error: issued.status, retryAfter: issued.retryAfter },
      429,
    );
  }

  const response: ApiResponse<never> = { success: true };
  return c.json(response, 201);
});

// POST /api/auth/otp-verify
// Body: { code: string } — validated by OtpVerifySchema
authRoute.post('/otp-verify', rateLimit(POLICIES.otpVerifyPerUser), zValidator('json', OtpVerifySchema), async (c) => {
  const { code } = c.req.valid('json');

  const check = await checkOtp(c.get('db'), c.env, c.get('dbUserId'), 'login', code);
  if (check.status === 'ok') {
    const response: ApiResponse<never> = { success: true };
    return c.json(response, 200);
  }
  const response: ApiResponse<never> = {
    success: false,
    error: check.status === 'not_found' ? 'otp_not_found' : check.status === 'max_attempts' ? 'max_attempts' : 'invalid_code',
  };
  return c.json(response, check.status === 'max_attempts' ? 429 : 400);
});

export default authRoute;
