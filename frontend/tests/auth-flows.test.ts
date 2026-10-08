import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn(async () => 'tok'),
  isAuthenticated: vi.fn(() => true),
}));

import {
  authPost,
  classifyCodeProblem,
  requestEmailVerification,
  confirmEmailVerification,
  requestRecoveryCode,
  confirmRecovery,
  AuthFlowNetworkError,
  type AuthFlowResult,
} from '@/api/authFlows';
import { getToken, isAuthenticated } from '@/auth/keycloak';

function reply(status: number, body: unknown, headers: Record<string, string> = {}): void {
  global.fetch = vi.fn(
    async () => new Response(body === null ? 'not json' : JSON.stringify(body), { status, headers }),
  ) as typeof fetch;
}
const lastCall = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];

describe('authFlows requests', () => {
  beforeEach(() => {
    vi.mocked(isAuthenticated).mockReturnValue(true);
    vi.mocked(getToken).mockResolvedValue('tok');
  });

  it('verification endpoints send the bearer token; recovery ones never do', async () => {
    reply(200, {});
    await requestEmailVerification();
    expect(lastCall()[0]).toMatch(/\/auth\/email-verify\/request$/);
    expect((lastCall()[1].headers as Record<string, string>)['Authorization']).toBe('Bearer tok');

    reply(200, {});
    await confirmEmailVerification('123456');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ code: '123456' });

    reply(202, {});
    await requestRecoveryCode('a@b.co');
    expect((lastCall()[1].headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ email: 'a@b.co' });

    reply(200, {});
    await confirmRecovery('a@b.co', '123456', 'pw');
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({ email: 'a@b.co', code: '123456', new_password: 'pw' });
  });

  it('does not put the code or password in the URL', async () => {
    reply(200, {});
    await confirmRecovery('a@b.co', '123456', 'secret-pass-12');
    expect(lastCall()[0]).not.toMatch(/123456|secret|a@b/);
  });

  it('still sends the request when the token cannot be read', async () => {
    vi.mocked(getToken).mockRejectedValue(new Error('expired'));
    reply(401, { code: 'unauthorized' });
    const r = await requestEmailVerification();
    expect(r.status).toBe(401);
  });

  it('reports success, error code, retryAfter (body or header) and attempts left', async () => {
    reply(429, { code: 'RATE_LIMITED', retryAfter: 42 });
    expect(await authPost('/x', {}, false)).toMatchObject({ ok: false, status: 429, error: 'rate_limited', retryAfter: 42 });
    reply(429, {}, { 'Retry-After': '17' });
    expect((await authPost('/x', {}, false)).retryAfter).toBe(17);
    reply(400, { error: 'invalid_code', attemptsLeft: 3 });
    expect(await authPost('/x', {}, false)).toMatchObject({ error: 'invalid_code', attemptsRemaining: 3 });
    reply(400, { error: 'invalid_code', attempts_remaining: '2' });
    expect((await authPost('/x', {}, false)).attemptsRemaining).toBe(2);
    reply(200, { success: true });
    expect(await authPost('/x', {}, false)).toMatchObject({ ok: true, error: null, retryAfter: null, attemptsRemaining: null });
  });

  it('tolerates non-JSON error bodies', async () => {
    reply(502, null);
    expect(await authPost('/x', {}, false)).toMatchObject({ ok: false, status: 502, error: 'unknown' });
  });

  it('a network failure throws AuthFlowNetworkError', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await expect(authPost('/x', {}, false)).rejects.toBeInstanceOf(AuthFlowNetworkError);
  });
});

describe('classifyCodeProblem', () => {
  const r = (status: number, error: string | null): AuthFlowResult => ({
    status, ok: status < 400, error, retryAfter: null, attemptsRemaining: null,
  });
  it.each([
    [429, 'rate_limited', 'rateLimited'],
    [400, 'invalid_code', 'wrong'],
    [400, 'unknown', 'wrong'],
    [400, 'code_expired', 'expired'],
    [410, 'gone', 'expired'],
    [400, 'otp_not_found', 'expired'],
    [400, 'max_attempts', 'locked'],
    [409, 'already_verified', 'alreadyVerified'],
    [422, 'weak_password', 'password'],
    [503, 'unavailable', 'unavailable'],
    [500, 'boom', 'other'],
    [400, 'something_else', 'other'],
  ])('%i %s -> %s', (status, error, expected) => {
    expect(classifyCodeProblem(r(status, error))).toBe(expected);
  });
});
