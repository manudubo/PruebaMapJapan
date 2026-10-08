import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn().mockResolvedValue('mock-token'),
  isAuthenticated: vi.fn().mockReturnValue(true),
  login: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/modules/toast', () => ({ showToast: vi.fn() }));

import { getMyTrips, EMAIL_NOT_VERIFIED_EVENT } from '@/api/client';

describe('request() 403 email_not_verified', () => {
  afterEach(() => vi.restoreAllMocks());

  async function call(status: number, body: unknown): Promise<{ events: number; error: unknown }> {
    vi.spyOn(global, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
    let events = 0;
    const on = (): void => { events++; };
    window.addEventListener(EMAIL_NOT_VERIFIED_EVENT, on);
    let error: unknown = null;
    try {
      await getMyTrips();
    } catch (e) {
      error = e;
    }
    window.removeEventListener(EMAIL_NOT_VERIFIED_EVENT, on);
    return { events, error };
  }

  it('announces the unverified account once and still rejects with the ApiError', async () => {
    const { events, error } = await call(403, { success: false, code: 'email_not_verified' });
    expect(events).toBe(1);
    expect(error).toMatchObject({ status: 403, code: 'email_not_verified' });
  });

  it('other 403s (or other statuses with that code) do not trigger the screen', async () => {
    expect((await call(403, { success: false, code: 'forbidden' })).events).toBe(0);
    expect((await call(404, { success: false, code: 'email_not_verified' })).events).toBe(0);
    expect((await call(403, null)).events).toBe(0);
  });
});
