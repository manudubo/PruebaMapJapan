import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
  isAuthenticated: vi.fn().mockReturnValue(true),
  login: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/modules/toast', () => ({
  showToast: vi.fn(),
}));

// Import AFTER mocks are set up
import { ApiError } from '@/api/client';

describe('ApiError', () => {
  it('has status, code, name=ApiError, and is instanceof Error', () => {
    const err = new ApiError(404, 'not_found');
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.name).toBe('ApiError');
    expect(err instanceof Error).toBe(true);
  });

  it('uses default message when none provided', () => {
    const err = new ApiError(404, 'not_found');
    expect(err.message).toContain('API error 404');
  });

  it('uses explicit message when provided', () => {
    const err = new ApiError(500, 'internal_error', 'Custom message');
    expect(err.message).toBe('Custom message');
  });
});

describe('request() 401 handling (BUG-02)', () => {
  // Fresh module graph per test so the once-per-page "session expired" guard
  // resets. Mocks are re-created too, so they are re-imported via load().
  async function load() {
    vi.resetModules();
    const client = await import('@/api/client');
    const toast = await import('@/modules/toast');
    const kc = await import('@/auth/keycloak');
    return { client, showToast: vi.mocked(toast.showToast), login: vi.mocked(kc.login) };
  }

  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(
      async () => new Response(null, { status: 401 }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with ApiError(401) instead of hanging', async () => {
    const { client } = await load();
    const p = client.getMyTrips();
    await expect(p).rejects.toBeInstanceOf(client.ApiError);
    await expect(p).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('shows the session-expired toast', async () => {
    const { client, showToast } = await load();
    await client.getMyTrips().catch(() => undefined);
    expect(showToast).toHaveBeenCalledWith(
      'Session expired — redirecting to login',
      'info',
    );
  });

  it('redirects to login immediately (no timer) with absolute dashboard.html URL', async () => {
    const { client, login } = await load();
    await client.getMyTrips().catch(() => undefined);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\/.*dashboard\.html$/));
  });

  it('toasts and redirects only once for concurrent 401s', async () => {
    const { client, showToast, login } = await load();
    const results = await Promise.allSettled([client.getMyTrips(), client.getMe()]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledTimes(1);
  });
});

describe('request() non-401 error handling', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: false, code: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ApiError with status and code from response', async () => {
    vi.resetModules();
    const client = await import('@/api/client');
    const p = client.getMyTrips();
    await expect(p).rejects.toBeInstanceOf(client.ApiError);
    await expect(p).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
