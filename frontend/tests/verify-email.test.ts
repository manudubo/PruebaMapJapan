// Email verification screen (src/auth/verifyEmail.ts): states, double submit, cooldown that
// survives a reload, two tabs, and every server answer the backend contract allows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  request: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(async () => true),
  logout: vi.fn(async () => {}),
  toast: vi.fn(),
}));

vi.mock('@/auth/keycloak', () => ({
  forceRefreshToken: h.refresh,
  logout: h.logout,
  appPageUrl: (p: string) => `https://app.test/PruebaMapJapan/${p}`,
}));
vi.mock('@/modules/toast', () => ({ showToast: h.toast }));
vi.mock('@/api/authFlows', async (orig) => ({
  ...(await orig<typeof import('@/api/authFlows')>()),
  requestEmailVerification: h.request,
  confirmEmailVerification: h.confirm,
}));

import {
  showEmailVerification,
  installEmailVerificationGate,
  isEmailVerificationShown,
  __resetVerifyEmailForTests,
  DEFAULT_RESEND_COOLDOWN_S,
  VERIFIED_SIGNAL_PREFIX,
  VERIFY_SECTION_ID,
} from '@/auth/verifyEmail';
import { AuthFlowNetworkError, type AuthFlowResult } from '@/api/authFlows';
import { EMAIL_NOT_VERIFIED_EVENT } from '@/api/client';
import { createCooldown } from '@/modules/cooldown';

const OPTS = { email: 'ana@example.com', userKey: 'u1' };

const ok = (extra: Partial<AuthFlowResult> = {}): AuthFlowResult => ({
  status: 200, ok: true, error: null, retryAfter: null, attemptsRemaining: null, ...extra,
});
const fail = (status: number, error: string, extra: Partial<AuthFlowResult> = {}): AuthFlowResult => ({
  status, ok: false, error, retryAfter: null, attemptsRemaining: null, ...extra,
});

const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const digits = () => Array.from(document.querySelectorAll<HTMLInputElement>('.code-input-digit'));
const errorText = () => q('.code-error').textContent;
const statusText = () => q('#verify-email-status').textContent;

function typeCode(code: string): void {
  const first = digits()[0]!;
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  e.clipboardData = { getData: () => code };
  first.dispatchEvent(e);
}

function mount(): void {
  document.body.innerHTML = '<main id="main-content"><div id="page">page</div></main>';
}

describe('email verification screen', () => {
  beforeEach(() => {
    mount();
    window.localStorage.clear();
    h.request.mockReset().mockResolvedValue(ok());
    h.confirm.mockReset().mockResolvedValue(ok());
    h.refresh.mockClear();
    h.logout.mockClear();
    h.toast.mockClear();
  });
  afterEach(() => {
    __resetVerifyEmailForTests();
    vi.restoreAllMocks();
  });

  it('replaces the page with an accessible, labelled screen and sends the first code', async () => {
    void showEmailVerification(OPTS);
    const section = q('#' + VERIFY_SECTION_ID);
    expect(section.getAttribute('aria-labelledby')).toBe('verify-email-title');
    expect(section.lang).toBe('en');
    expect(q('h1').textContent).toBe('Verify your email');
    expect(q('#verify-email-body').textContent).toContain('ana@example.com');
    expect(q<HTMLElement>('#page').hidden).toBe(true);
    expect(digits()).toHaveLength(6);
    expect(q('fieldset').getAttribute('aria-describedby')).toBe('verify-email-body verify-email-error');
    expect(q('.code-error').getAttribute('role')).toBe('alert');
    expect(q('#verify-email-status').getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(digits()[0]);
    expect(isEmailVerificationShown()).toBe(true);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
  });

  it('shows a generic body when the email is unknown', () => {
    void showEmailVerification({ email: null, userKey: 'u1' });
    expect(q('#verify-email-body').textContent).not.toContain('{email}');
    expect(q('#verify-email-body').textContent).toContain('your email address');
  });

  it('starts a visible resend cooldown from the server value (default when absent)', async () => {
    h.request.mockResolvedValue(ok({ retryAfter: 45 }));
    void showEmailVerification(OPTS);
    await vi.waitFor(() => expect(q<HTMLButtonElement>('#verify-email-resend').disabled).toBe(true));
    expect(q('#verify-email-resend').textContent).toBe('Resend code in 45s');
    __resetVerifyEmailForTests();
    window.localStorage.clear();
    mount();
    h.request.mockResolvedValue(ok());
    void showEmailVerification(OPTS);
    await vi.waitFor(() => expect(q('#verify-email-resend').textContent).toBe(`Resend code in ${DEFAULT_RESEND_COOLDOWN_S}s`));
  });

  it('a reload during the cooldown does not request another code', async () => {
    createCooldown('email-verify.u1').start(30);
    void showEmailVerification(OPTS);
    await Promise.resolve();
    expect(h.request).not.toHaveBeenCalled();
    expect(q<HTMLButtonElement>('#verify-email-resend').disabled).toBe(true);
    expect(q('#verify-email-resend').textContent).toMatch(/^Resend code in (29|30)s$/);
    q<HTMLButtonElement>('#verify-email-resend').click();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('a 429 on load is silent (a code was sent moments ago) but starts the countdown', async () => {
    h.request.mockResolvedValue(fail(429, 'rate_limited', { retryAfter: 20 }));
    void showEmailVerification(OPTS);
    await vi.waitFor(() => expect(q('#verify-email-resend').textContent).toBe('Resend code in 20s'));
    expect(errorText()).toBe('');
  });

  it('a network error on load is reported and Resend stays usable', async () => {
    h.request.mockRejectedValue(new AuthFlowNetworkError());
    void showEmailVerification(OPTS);
    await vi.waitFor(() => expect(errorText()).toMatch(/reach the server/));
    expect(q<HTMLButtonElement>('#verify-email-resend').disabled).toBe(false);
  });

  it('happy path: complete code -> confirm once -> token refresh -> screen gone, page back', async () => {
    const done = showEmailVerification(OPTS);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalled());
    typeCode('123 456');
    await done;
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.confirm).toHaveBeenCalledWith('123456');
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(document.getElementById(VERIFY_SECTION_ID)).toBeNull();
    expect(q<HTMLElement>('#page').hidden).toBe(false);
    expect(isEmailVerificationShown()).toBe(false);
    expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/verified/i), 'success');
    expect(window.localStorage.getItem(VERIFIED_SIGNAL_PREFIX + 'u1')).not.toBeNull();
    expect(createCooldown('email-verify.u1').remaining()).toBe(0);
  });

  it('double submit (code complete + Verify click + Enter) sends one request', async () => {
    let release!: (r: AuthFlowResult) => void;
    h.confirm.mockReturnValue(new Promise<AuthFlowResult>((r) => { release = r; }));
    const done = showEmailVerification(OPTS);
    typeCode('123456');
    q<HTMLButtonElement>('#verify-email-submit').click();
    q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(q<HTMLButtonElement>('#verify-email-submit').disabled).toBe(true);
    expect(q('#verify-email-submit').getAttribute('aria-busy')).toBe('true');
    expect(digits().every((d) => d.disabled)).toBe(true);
    release(ok());
    await done;
    expect(h.confirm).toHaveBeenCalledTimes(1);
  });

  it('wrong code: message with attempts left, boxes cleared, invalid state, focus back', async () => {
    h.confirm.mockResolvedValue(fail(400, 'invalid_code', { attemptsRemaining: 3 }));
    void showEmailVerification(OPTS);
    typeCode('111111');
    await vi.waitFor(() => expect(errorText()).toBe("That code isn't right. Attempts left: 3."));
    expect(digits().every((d) => d.value === '')).toBe(true);
    expect(digits().every((d) => d.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(document.activeElement).toBe(digits()[0]);
    expect(isEmailVerificationShown()).toBe(true);
    // typing again retries
    h.confirm.mockResolvedValue(fail(400, 'invalid_code'));
    typeCode('222222');
    await vi.waitFor(() => expect(errorText()).toBe("That code isn't right. Check it and try again."));
  });

  it('expired code: says so and offers a new one', async () => {
    createCooldown('email-verify.u1').clear();
    h.confirm.mockResolvedValue(fail(410, 'code_expired'));
    void showEmailVerification(OPTS);
    typeCode('123456');
    await vi.waitFor(() => expect(errorText()).toBe('That code has expired. Request a new one.'));
    expect(digits().every((d) => d.value === '')).toBe(true);
  });

  it('too many attempts: asks for a new code', async () => {
    h.confirm.mockResolvedValue(fail(400, 'max_attempts'));
    void showEmailVerification(OPTS);
    typeCode('123456');
    await vi.waitFor(() => expect(errorText()).toBe('Too many attempts. Request a new code.'));
  });

  it('429 on confirm shows the wait', async () => {
    h.confirm.mockResolvedValue(fail(429, 'rate_limited', { retryAfter: 33 }));
    void showEmailVerification(OPTS);
    typeCode('123456');
    await vi.waitFor(() => expect(errorText()).toBe('Too many requests. Try again in 33s.'));
  });

  it('network error on confirm keeps the screen and lets the user retry', async () => {
    h.confirm.mockRejectedValueOnce(new AuthFlowNetworkError());
    void showEmailVerification(OPTS);
    typeCode('123456');
    await vi.waitFor(() => expect(errorText()).toMatch(/reach the server/));
    expect(q<HTMLButtonElement>('#verify-email-submit').disabled).toBe(false);
    h.confirm.mockResolvedValue(ok());
    typeCode('123456');
    await vi.waitFor(() => expect(isEmailVerificationShown()).toBe(false));
  });

  it('unknown server error is generic', async () => {
    h.confirm.mockResolvedValue(fail(500, 'boom'));
    void showEmailVerification(OPTS);
    typeCode('123456');
    await vi.waitFor(() => expect(errorText()).toBe('Something went wrong. Please try again.'));
  });

  it('submitting an incomplete code explains and sends nothing', async () => {
    void showEmailVerification(OPTS);
    digits()[0]!.value = '1';
    q<HTMLButtonElement>('#verify-email-submit').click();
    expect(errorText()).toBe('Enter all 6 digits of the code.');
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it('already verified (other tab got there first) just continues', async () => {
    h.confirm.mockResolvedValue(fail(409, 'already_verified'));
    const done = showEmailVerification(OPTS);
    typeCode('123456');
    await done;
    expect(h.refresh).toHaveBeenCalled();
  });

  it('Resend: sends, confirms with a status message, restarts the cooldown, and guards spam clicks', async () => {
    void showEmailVerification(OPTS);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    createCooldown('email-verify.u1').clear();
    const resend = q<HTMLButtonElement>('#verify-email-resend');
    h.request.mockResolvedValue(ok({ retryAfter: 40 }));
    resend.disabled = false;
    resend.click();
    resend.click();
    await vi.waitFor(() => expect(statusText()).toBe('We sent you a new code.'));
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toBe('Resend code in 40s');
    expect(document.activeElement).toBe(digits()[0]);
  });

  it('Resend answered 429 shows the wait and disables the button', async () => {
    void showEmailVerification(OPTS);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    createCooldown('email-verify.u1').clear();
    h.request.mockResolvedValue(fail(429, 'rate_limited', { retryAfter: 25 }));
    q<HTMLButtonElement>('#verify-email-resend').disabled = false; // the 1 s tick would do this
    q<HTMLButtonElement>('#verify-email-resend').click();
    await vi.waitFor(() => expect(errorText()).toBe('Too many requests. Try again in 25s.'));
    expect(q<HTMLButtonElement>('#verify-email-resend').disabled).toBe(true);
  });

  it('"Use a different account" signs out to the landing page, once', async () => {
    void showEmailVerification(OPTS);
    const btn = q<HTMLButtonElement>('#verify-email-other-account');
    btn.click();
    btn.click();
    expect(h.logout).toHaveBeenCalledTimes(1);
    expect(h.logout).toHaveBeenCalledWith('https://app.test/PruebaMapJapan/index.html');
    expect(btn.disabled).toBe(true);
  });

  it('another tab verifying (storage event) completes this one', async () => {
    const done = showEmailVerification(OPTS);
    window.dispatchEvent(new StorageEvent('storage', { key: VERIFIED_SIGNAL_PREFIX + 'u1', newValue: '1' }));
    await done;
    expect(document.getElementById(VERIFY_SECTION_ID)).toBeNull();
    // this tab did not verify: it must not announce a signal itself
    expect(window.localStorage.getItem(VERIFIED_SIGNAL_PREFIX + 'u1')).toBeNull();
  });

  it('a storage event for another user is ignored', () => {
    void showEmailVerification(OPTS);
    window.dispatchEvent(new StorageEvent('storage', { key: VERIFIED_SIGNAL_PREFIX + 'someone-else', newValue: '1' }));
    expect(isEmailVerificationShown()).toBe(true);
  });

  it('showing it twice joins the same screen', () => {
    const a = showEmailVerification(OPTS);
    const b = showEmailVerification(OPTS);
    expect(a).toBe(b);
    expect(document.querySelectorAll('#' + VERIFY_SECTION_ID)).toHaveLength(1);
  });

  it('works with storage blocked (cooldown in memory, no signal)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const done = showEmailVerification(OPTS);
    await vi.waitFor(() => expect(q('#verify-email-resend').textContent).toMatch(/Resend code in/));
    typeCode('123456');
    await done;
    expect(isEmailVerificationShown()).toBe(false);
  });

  it('page without <main>: falls back to body and still restores', async () => {
    document.body.innerHTML = '<div id="page">page</div>';
    const done = showEmailVerification(OPTS);
    expect(q<HTMLElement>('#page').hidden).toBe(true);
    typeCode('123456');
    await done;
    expect(q<HTMLElement>('#page').hidden).toBe(false);
  });
});

describe('email verification gate (403 email_not_verified)', () => {
  beforeEach(() => {
    mount();
    window.localStorage.clear();
    h.request.mockReset().mockResolvedValue(ok());
    h.confirm.mockReset().mockResolvedValue(ok());
  });
  afterEach(() => __resetVerifyEmailForTests());

  it('shows the screen on the event and runs onVerified afterwards; one screen for many 403s', async () => {
    const onVerified = vi.fn();
    const off = installEmailVerificationGate(() => OPTS, onVerified);
    window.dispatchEvent(new Event(EMAIL_NOT_VERIFIED_EVENT));
    window.dispatchEvent(new Event(EMAIL_NOT_VERIFIED_EVENT));
    expect(document.querySelectorAll('#' + VERIFY_SECTION_ID)).toHaveLength(1);
    typeCode('123456');
    await vi.waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    off();
    window.dispatchEvent(new Event(EMAIL_NOT_VERIFIED_EVENT));
    expect(isEmailVerificationShown()).toBe(false);
  });

  it('does nothing when there is no signed-in user to verify', () => {
    const off = installEmailVerificationGate(() => null, vi.fn());
    window.dispatchEvent(new Event(EMAIL_NOT_VERIFIED_EVENT));
    expect(isEmailVerificationShown()).toBe(false);
    off();
  });
});
