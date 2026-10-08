// watchAuth installs the email-verification gate once the user is signed in, on every
// auth-gated page, and never when signed out or when Keycloak is down.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  status: 'authenticated' as 'authenticated' | 'anonymous' | 'unavailable',
  gate: vi.fn(() => () => {}),
  context: null as null | (() => { email: string | null; userKey: string } | null),
  user: { id: 'kc-1', email: 'ana@example.com' } as { id: string; email: string } | null,
}));

vi.mock('@/auth/keycloak', () => ({
  initKeycloak: vi.fn(async () => true),
  retryAuth: vi.fn(async () => true),
  getAuthStatus: () => h.status,
  getAuthUnavailableReason: () => null,
  onAuthStatusChange: () => () => {},
  getUserInfo: () => h.user,
}));
vi.mock('@/auth/verifyEmail', () => ({
  installEmailVerificationGate: (ctx: () => { email: string | null; userKey: string } | null) => {
    h.context = ctx;
    return h.gate();
  },
}));

async function load() {
  vi.resetModules();
  return import('@/auth/authStatusUI');
}

beforeEach(() => {
  h.status = 'authenticated';
  h.gate.mockClear();
  h.context = null;
  h.user = { id: 'kc-1', email: 'ana@example.com' };
});

describe('watchAuth + verification gate', () => {
  it('installs the gate when signed in, once, even across several watchers', async () => {
    const ui = await load();
    const authenticated = vi.fn();
    ui.watchAuth({ authenticated });
    ui.watchAuth({ authenticated });
    await vi.waitFor(() => expect(authenticated).toHaveBeenCalledTimes(2));
    expect(h.gate).toHaveBeenCalledTimes(1);
  });

  it('the gate reads the current user lazily (token claims) and tolerates a missing user', async () => {
    const ui = await load();
    ui.watchAuth({ authenticated: vi.fn() });
    await vi.waitFor(() => expect(h.context).not.toBeNull());
    expect(h.context!()).toEqual({ email: 'ana@example.com', userKey: 'kc-1' });
    h.user = { id: 'kc-1', email: '' };
    expect(h.context!()).toEqual({ email: null, userKey: 'kc-1' });
    h.user = null;
    expect(h.context!()).toBeNull();
  });

  it.each(['anonymous', 'unavailable'] as const)('does nothing when %s', async (status) => {
    h.status = status;
    const ui = await load();
    const handler = vi.fn();
    ui.watchAuth({ [status]: handler });
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect(h.gate).not.toHaveBeenCalled();
  });
});
