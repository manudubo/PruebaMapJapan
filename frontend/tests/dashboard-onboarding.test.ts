// What the dashboard does right after sign-in: unverified accounts get the verification screen
// before anything else; a just-registered account gets the onboarding dialog; everyone else
// keeps the existing passkey nudge / OTP banner. Real dashboard.ts, mocked collaborators.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const h = vi.hoisted(() => ({
  webauthn: true,
  show: vi.fn(async () => {}),
  gate: vi.fn(() => () => {}),
  onboarding: vi.fn(async () => 'later'),
  nudge: vi.fn(),
  store: vi.fn(() => ({ load: vi.fn(), save: vi.fn() })),
  order: [] as string[],
}));

vi.mock('keycloak-js', () => ({
  default: class FakeKeycloak {
    authenticated = false;
    token: string | undefined;
    tokenParsed: Record<string, unknown> | undefined;
    init = vi.fn(async () => {
      this.authenticated = true;
      this.token = 'tok';
      this.tokenParsed = { sub: 'kc-user-1', name: 'Ana Perez', email: 'ana@example.com' };
      return true;
    });
    login = vi.fn(async () => {});
    isTokenExpired = vi.fn(() => false);
    updateToken = vi.fn(async () => true);
  },
}));
vi.mock('@/components/Navbar', () => ({}));
vi.mock('@/components/SearchBar', () => ({}));
vi.mock('@/modules/passkeyCampaign', () => ({
  checkPasskeyCampaign: h.nudge,
  createPrefsStore: h.store,
  runNewUserOnboarding: h.onboarding,
}));
vi.mock('@/auth/verifyEmail', () => ({
  showEmailVerification: h.show,
  installEmailVerificationGate: h.gate,
}));

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMyTrips: vi.fn(),
  createTrip: vi.fn(),
  updateMe: vi.fn(),
  EMAIL_NOT_VERIFIED_EVENT: 'travelmap:email-not-verified',
  ApiError: class ApiError extends Error {
    constructor(public status: number, public code: string) { super(code); }
  },
  apiUrl: (p: string) => `http://localhost:8787/api${p}`,
}));
vi.mock('@/api/client', () => api);

const DASHBOARD_BODY = (() => {
  const html = readFileSync(resolve(__dirname, '..', 'dashboard.html'), 'utf8');
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
})();

const USER = { id: 1, name: 'Ana Perez', email: 'ana@example.com', preferences: null, email_verified: true };

async function loadDashboard(): Promise<void> {
  vi.resetModules();
  await import('@/pages/dashboard');
  await vi.waitFor(() => expect(api.getMyTrips).toHaveBeenCalled());
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => true });
  Object.defineProperty(window, 'PublicKeyCredential', { value: h.webauthn ? class {} : undefined, configurable: true, writable: true });
  h.show.mockReset().mockImplementation(async () => { h.order.push('verify'); });
  h.onboarding.mockReset().mockImplementation(async () => { h.order.push('onboarding'); return 'later'; });
  h.nudge.mockReset();
  h.gate.mockClear();
  h.store.mockClear();
  h.order.length = 0;
  api.getMe.mockReset().mockResolvedValue(USER);
  api.getMyTrips.mockReset().mockImplementation(async () => { h.order.push('trips'); return []; });
  api.updateMe.mockReset().mockResolvedValue({});
  document.body.innerHTML = DASHBOARD_BODY;
});

afterEach(() => vi.restoreAllMocks());

describe('dashboard after sign-in', () => {
  it('a verified existing user keeps the passkey nudge; no onboarding, no verification', async () => {
    await loadDashboard();
    expect(h.show).not.toHaveBeenCalled();
    expect(h.onboarding).not.toHaveBeenCalled();
    expect(h.nudge).toHaveBeenCalledWith('kc-user-1');
    expect(h.gate).toHaveBeenCalledTimes(1); // installed by watchAuth
  });

  it('a user with email_verified=false must verify before the trips load, then is not asked again', async () => {
    api.getMe.mockResolvedValue({ ...USER, email_verified: false, onboarding: { is_new: true } });
    await loadDashboard();
    expect(h.show).toHaveBeenCalledWith({ email: 'ana@example.com', userKey: 'kc-user-1' });
    await vi.waitFor(() => expect(h.onboarding).toHaveBeenCalled());
    expect(h.order.slice(0, 2)).toEqual(['verify', 'onboarding']);
    expect(h.order).toContain('trips');
    expect(h.order.indexOf('verify')).toBeLessThan(h.order.indexOf('trips'));
  });

  it('403 email_not_verified from GET /users/me leaves the screen (and the reload) to the gate', async () => {
    api.getMe.mockRejectedValue(new api.ApiError(403, 'email_not_verified'));
    vi.resetModules();
    await import('@/pages/dashboard');
    await vi.waitFor(() => expect(api.getMe).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(h.show).not.toHaveBeenCalled(); // no second screen, no double reload
    expect(api.getMyTrips).not.toHaveBeenCalled(); // nothing is fetched behind the screen
    expect(h.onboarding).not.toHaveBeenCalled();
    expect(h.nudge).not.toHaveBeenCalled();
  });

  it('other /users/me failures are not an unverified account', async () => {
    api.getMe.mockRejectedValue(new api.ApiError(500, 'boom'));
    await loadDashboard();
    expect(h.show).not.toHaveBeenCalled();
    expect(h.nudge).toHaveBeenCalledWith('kc-user-1'); // unknown -> existing behavior
  });

  it('a just-registered user gets the onboarding dialog instead of the redirect nudge', async () => {
    api.getMe.mockResolvedValue({ ...USER, onboarding: { is_new: true }, preferences: { theme: 'dark' } });
    await loadDashboard();
    expect(h.onboarding).toHaveBeenCalledWith(expect.objectContaining({ isNew: true, userKey: 'kc-user-1' }));
    expect(h.nudge).not.toHaveBeenCalled();
    expect(h.store).toHaveBeenCalledWith('kc-user-1', { theme: 'dark' }, expect.any(Function));
    // the store's writer sends PATCH /users/me {preferences}
    const writer = (h.store.mock.calls[0] as unknown as [string, unknown, (p: Record<string, unknown>) => Promise<unknown>])[2];
    await writer({ a: 1 });
    expect(api.updateMe).toHaveBeenCalledWith({ preferences: { a: 1 } });
  });

  it('on a device without WebAuthn the existing user keeps the OTP banner', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true, writable: true });
    await loadDashboard();
    expect(document.getElementById('otp-banner')).not.toBeNull();
    expect(h.nudge).not.toHaveBeenCalled();
  });

  it('a new user without WebAuthn gets the onboarding (password variant), not the OTP banner', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true, writable: true });
    api.getMe.mockResolvedValue({ ...USER, onboarding: { is_new: true } });
    await loadDashboard();
    expect(h.onboarding).toHaveBeenCalled();
    expect(document.getElementById('otp-banner')).toBeNull();
  });
});
