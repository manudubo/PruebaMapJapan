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
import { showToast } from '@/modules/toast';
import { login } from '@/auth/keycloak';

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

describe('request() 401 handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    vi.mocked(showToast).mockClear();
    vi.mocked(login).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls showToast with session-expired message and info type', async () => {
    const { getMyTrips } = await import('@/api/client');
    void Promise.race([
      getMyTrips(),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith(
      'Session expired — redirecting to login',
      'info',
    );
  });

  it('schedules login("dashboard.html") after 1500ms', async () => {
    const { getMyTrips } = await import('@/api/client');
    void Promise.race([
      getMyTrips(),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
    ]);
    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    expect(login).toHaveBeenCalledWith('dashboard.html');
  });

  it('returns a promise that does not resolve (never-resolving)', async () => {
    const { getMyTrips } = await import('@/api/client');
    const result = await Promise.race([
      getMyTrips().then(() => 'resolved'),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 50)),
    ]);
    await vi.runAllTimersAsync();
    expect(result).toBe('timeout');
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
    const { getMyTrips } = await import('@/api/client');
    const p = getMyTrips();
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
