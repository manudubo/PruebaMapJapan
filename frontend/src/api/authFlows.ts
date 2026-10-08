/**
 * Calls for the email-code flows: verification at sign-up (authenticated) and account
 * recovery (anonymous). Unlike api/client.ts request(), these return the raw outcome
 * (status, error code, Retry-After, attempts left) instead of throwing, because the screens
 * show a specific message for each case, and a 401 here must not start a login redirect.
 * Only a network failure throws (AuthFlowNetworkError).
 *
 * Contract (backend, see .planning/qa/REGISTRATION-UI-REPORT.md):
 *   POST /auth/email-verify/request                     -> 2xx | 429 {retryAfter}
 *   POST /auth/email-verify/confirm {code}              -> 2xx | 400 invalid_code {attemptsLeft?} | 400/410 expired | 429
 *   POST /auth/recovery/request {email}                 -> 2xx always (anti-enumeration) | 429
 *   POST /auth/recovery/confirm {email, code, new_password}
 *                                                       -> 2xx | 400 invalid_code | 422 weak_password | 429 | 503
 */

import { apiUrl } from '@/api/client';
import { getToken, isAuthenticated } from '@/auth/keycloak';

export class AuthFlowNetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network error');
    this.name = 'AuthFlowNetworkError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface AuthFlowResult {
  status: number;
  ok: boolean;
  /** Machine-readable error (`code` or `error` of the envelope), lower-cased; null on success. */
  error: string | null;
  /** Seconds to wait (body retryAfter/retry_after or the Retry-After header). */
  retryAfter: number | null;
  attemptsRemaining: number | null;
}

function num(...values: unknown[]): number | null {
  for (const v of values) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export async function authPost(path: string, body: unknown, auth: boolean): Promise<AuthFlowResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && isAuthenticated()) {
    try {
      headers['Authorization'] = `Bearer ${await getToken()}`;
    } catch {
      // Expired session: the server answers 401 and the screen says so.
    }
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new AuthFlowNetworkError(err);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const rawError = data?.['code'] ?? data?.['error'];
  return {
    status: res.status,
    ok: res.ok,
    error: res.ok ? null : typeof rawError === 'string' ? rawError.toLowerCase() : 'unknown',
    retryAfter: num(data?.['retryAfter'], data?.['retry_after'], res.headers.get('Retry-After')),
    attemptsRemaining: num(
      data?.['attemptsLeft'],
      data?.['attempts_left'],
      data?.['attemptsRemaining'],
      data?.['attempts_remaining'],
      data?.['remainingAttempts'],
      data?.['remaining_attempts'],
    ),
  };
}

export const requestEmailVerification = (): Promise<AuthFlowResult> =>
  authPost('/auth/email-verify/request', undefined, true);

export const confirmEmailVerification = (code: string): Promise<AuthFlowResult> =>
  authPost('/auth/email-verify/confirm', { code }, true);

export const requestRecoveryCode = (email: string): Promise<AuthFlowResult> =>
  authPost('/auth/recovery/request', { email }, false);

export const confirmRecovery = (email: string, code: string, newPassword: string): Promise<AuthFlowResult> =>
  authPost('/auth/recovery/confirm', { email, code, new_password: newPassword }, false);

export type CodeProblem =
  | 'rateLimited'
  | 'expired'
  | 'locked'
  | 'alreadyVerified'
  | 'password'
  | 'wrong'
  | 'unavailable'
  | 'other';

/** What went wrong with a code request/confirmation, for the message to show. */
export function classifyCodeProblem(result: AuthFlowResult): CodeProblem {
  const e = result.error ?? '';
  if (result.status === 429) return 'rateLimited';
  if (result.status === 503) return 'unavailable';
  if (result.status === 410) return 'expired';
  if (/already_verified|already-verified/.test(e)) return 'alreadyVerified';
  if (/expired|not_found|no_code|no_active/.test(e)) return 'expired';
  if (/max_attempts|too_many|locked/.test(e)) return 'locked';
  if (/password|weak|policy/.test(e)) return 'password';
  if (result.status === 400 || result.status === 422) {
    return /invalid|wrong|incorrect|mismatch|code|unknown/.test(e) || e === '' ? 'wrong' : 'other';
  }
  return 'other';
}
