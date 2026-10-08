// Account recovery view: the three steps, anti-enumeration, secrets out of the URL, 429
// countdowns, and double-submit protection. Real view + cooldown/code input, mocked API.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountRecover, takeEmailPrefill, isPlausibleEmail, RECOVER_REQUEST_COOLDOWN, type RecoverHandle } from '@/pages/recoverView';
import { AuthFlowNetworkError, type AuthFlowResult } from '@/api/authFlows';
import { createCooldown } from '@/modules/cooldown';

const ok = (extra: Partial<AuthFlowResult> = {}): AuthFlowResult => ({
  status: 202, ok: true, error: null, retryAfter: null, attemptsRemaining: null, ...extra,
});
const fail = (status: number, error: string, extra: Partial<AuthFlowResult> = {}): AuthFlowResult => ({
  status, ok: false, error, retryAfter: null, attemptsRemaining: null, ...extra,
});

const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const text = (sel: string) => q(sel).textContent;
const digits = () => Array.from(document.querySelectorAll<HTMLInputElement>('.code-input-digit'));

function fillEmail(value: string): void {
  q<HTMLInputElement>('#recover-email').value = value;
}
function submitForm(): void {
  q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}
function typeCode(code: string): void {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
  e.clipboardData = { getData: () => code };
  digits()[0]!.dispatchEvent(e);
}
function typePasswords(pw: string, confirm = pw): void {
  q<HTMLInputElement>('#recover-password').value = pw;
  q<HTMLInputElement>('#recover-password').dispatchEvent(new Event('input'));
  q<HTMLInputElement>('#recover-confirm').value = confirm;
  q<HTMLInputElement>('#recover-confirm').dispatchEvent(new Event('input'));
}

describe('recover view', () => {
  let requestCode: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let signIn: ReturnType<typeof vi.fn>;
  let handle: RecoverHandle;

  function mount(prefill: string | null = null): void {
    document.body.innerHTML = '<div id="root"></div>';
    handle = mountRecover(q('#root'), { prefillEmail: prefill }, {
      requestCode: requestCode as never,
      confirm: confirm as never,
      signIn: signIn as never,
      locale: 'en',
    });
  }
  async function toCodeStep(email = 'ana@example.com'): Promise<void> {
    mount();
    fillEmail(email);
    submitForm();
    await vi.waitFor(() => expect(handle.step()).toBe('code'));
  }

  beforeEach(() => {
    window.localStorage.clear();
    requestCode = vi.fn(async () => ok());
    confirm = vi.fn(async () => ok({ status: 200 }));
    signIn = vi.fn();
  });
  afterEach(() => {
    handle?.destroy();
    vi.restoreAllMocks();
  });

  describe('step 1: email', () => {
    it('is a labelled form with one h1, email semantics and a prefill', () => {
      mount('ana@example.com');
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      expect(text('h1')).toBe("Can't use your passkey?");
      const input = q<HTMLInputElement>('#recover-email');
      expect(input.type).toBe('email');
      expect(input.autocomplete).toBe('email');
      expect(input.value).toBe('ana@example.com');
      expect(document.querySelector('label[for="recover-email"]')!.textContent).toBe('Email address');
      expect(q('#recover-email-error').getAttribute('role')).toBe('alert');
      expect(q('#root').lang).toBe('en');
    });

    it('rejects an invalid email locally, without calling the API', () => {
      mount();
      fillEmail('not-an-email');
      submitForm();
      expect(text('#recover-email-error')).toBe('Enter a valid email address.');
      expect(q('#recover-email').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(q('#recover-email'));
      expect(requestCode).not.toHaveBeenCalled();
    });

    it('sends the trimmed address and moves to the code step with the generic message', async () => {
      await toCodeStep('  ana@example.com ');
      expect(requestCode).toHaveBeenCalledWith('ana@example.com');
      expect(text('#recover-sent')).toBe(
        'If an account exists for ana@example.com, we sent a 6-digit code to it. Enter it below with your new password.',
      );
      expect(q('#recover-sent').getAttribute('role')).toBe('status');
    });

    it('anti-enumeration: an unknown address (404) and a known one (202) look identical', async () => {
      requestCode.mockResolvedValue(fail(404, 'not_found'));
      await toCodeStep('ghost@example.com');
      const unknown = q('#root').innerHTML.replace(/ghost@example\.com/g, 'X');
      handle.destroy();

      requestCode.mockResolvedValue(ok());
      window.localStorage.clear();
      await toCodeStep('ana@example.com');
      const known = q('#root').innerHTML.replace(/ana@example\.com/g, 'X');
      expect(unknown).toBe(known);
    });

    it('double submit sends one request and shows the busy state', async () => {
      let release!: (r: AuthFlowResult) => void;
      requestCode.mockReturnValue(new Promise<AuthFlowResult>((r) => { release = r; }));
      mount('ana@example.com');
      submitForm();
      submitForm();
      expect(requestCode).toHaveBeenCalledTimes(1);
      expect(q<HTMLButtonElement>('#recover-send').disabled).toBe(true);
      expect(text('#recover-send')).toBe('Sending…');
      release(ok());
      await vi.waitFor(() => expect(handle.step()).toBe('code'));
    });

    it('429 shows the wait and a disabled button with a countdown, which survives a reload', async () => {
      requestCode.mockResolvedValue(fail(429, 'rate_limited', { retryAfter: 90 }));
      mount('ana@example.com');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-send')).toBe('Send code in 90s'));
      expect(q<HTMLButtonElement>('#recover-send').disabled).toBe(true);
      expect(text('#recover-email-error')).toMatch(/Too many requests\. Try again in (89|90)s\./);
      expect(handle.step()).toBe('email');
      // reload: new mount, same storage
      handle.destroy();
      mount('ana@example.com');
      expect(q<HTMLButtonElement>('#recover-send').disabled).toBe(true);
      expect(text('#recover-send')).toMatch(/^Send code in (89|90)s$/);
      submitForm();
      expect(requestCode).toHaveBeenCalledTimes(1);
    });

    it('network and server errors are reported and retryable', async () => {
      requestCode.mockRejectedValueOnce(new AuthFlowNetworkError());
      mount('ana@example.com');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-email-error')).toMatch(/reach the server/));
      expect(q<HTMLButtonElement>('#recover-send').disabled).toBe(false);
      requestCode.mockResolvedValueOnce(fail(500, 'boom'));
      submitForm();
      await vi.waitFor(() => expect(text('#recover-email-error')).toBe('Something went wrong. Please try again.'));
    });

    it('a 400 from the server is reported as an invalid address', async () => {
      requestCode.mockResolvedValue(fail(400, 'invalid_email'));
      mount('ana@example.com');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-email-error')).toBe('Enter a valid email address.'));
    });
  });

  describe('step 2: code and new password', () => {
    it('has a code fieldset, labelled password fields, a toggle and a live checklist', async () => {
      await toCodeStep();
      expect(digits()).toHaveLength(6);
      expect(q('fieldset').getAttribute('aria-describedby')).toBe('recover-sent recover-error');
      const pw = q<HTMLInputElement>('#recover-password');
      expect(pw.type).toBe('password');
      expect(pw.autocomplete).toBe('new-password');
      expect(document.querySelector('label[for="recover-password"]')!.textContent).toBe('New password');
      expect(document.querySelector('label[for="recover-confirm"]')!.textContent).toBe('Confirm new password');
      const list = q('#recover-rules');
      expect(list.getAttribute('aria-live')).toBe('polite');
      expect(list.getAttribute('aria-labelledby')).toBe('recover-rules-title');
      expect(list.querySelectorAll('li')).toHaveLength(3);
      expect(document.activeElement).toBe(digits()[0]);
    });

    it('the checklist updates as the user types and says met/not met in words', async () => {
      await toCodeStep();
      const state = (id: string) => q(`[data-rule="${id}"]`).textContent;
      expect(state('length')).toContain('(not met)');
      typePasswords('short');
      expect(state('length')).toContain('(not met)');
      typePasswords('a-long-enough-pass', 'different');
      expect(state('length')).toContain('(met)');
      expect(state('match')).toContain('(not met)');
      typePasswords('a-long-enough-pass');
      expect(state('match')).toContain('(met)');
      typePasswords('ana@example.com');
      expect(state('notEmail')).toContain('(not met)');
    });

    it('show/hide toggles both fields and the accessible name', async () => {
      await toCodeStep();
      const toggle = q<HTMLButtonElement>('#recover-toggle');
      expect(toggle.getAttribute('aria-label')).toBe('Show password');
      toggle.click();
      expect(q<HTMLInputElement>('#recover-password').type).toBe('text');
      expect(q<HTMLInputElement>('#recover-confirm').type).toBe('text');
      expect(toggle.getAttribute('aria-label')).toBe('Hide password');
      toggle.click();
      expect(q<HTMLInputElement>('#recover-password').type).toBe('password');
    });

    it('an unmet requirement or incomplete code blocks the request and explains', async () => {
      await toCodeStep();
      submitForm();
      expect(text('#recover-error')).toBe('Enter all 6 digits of the code.');
      typeCode('123456');
      typePasswords('short');
      submitForm();
      expect(text('#recover-error')).toBe("Your password doesn't meet the requirements yet.");
      expect(confirm).not.toHaveBeenCalled();
    });

    it('happy path: code + password go in the body only, then the success screen with Sign in', async () => {
      await toCodeStep();
      typeCode('123 456');
      typePasswords('correct horse battery');
      submitForm();
      await vi.waitFor(() => expect(handle.step()).toBe('done'));
      expect(confirm).toHaveBeenCalledWith('ana@example.com', '123456', 'correct horse battery');
      expect(window.location.href).not.toMatch(/123456|correct|battery/);
      expect(text('h1')).toBe('Your password is set');
      expect(document.activeElement).toBe(q('h1'));
      q<HTMLButtonElement>('#recover-signin').click();
      q<HTMLButtonElement>('#recover-signin').click();
      expect(signIn).toHaveBeenCalledTimes(1);
      expect(createCooldown(RECOVER_REQUEST_COOLDOWN).remaining()).toBe(0);
      expect(document.querySelector('input[type="password"]')).toBeNull();
    });

    it('double submit sends one confirm request', async () => {
      let release!: (r: AuthFlowResult) => void;
      confirm.mockReturnValue(new Promise<AuthFlowResult>((r) => { release = r; }));
      await toCodeStep();
      typeCode('123456');
      typePasswords('correct horse battery');
      submitForm();
      submitForm();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(text('#recover-submit')).toBe('Saving…');
      release(ok({ status: 200 }));
      await vi.waitFor(() => expect(handle.step()).toBe('done'));
    });

    it.each([
      ['wrong code', fail(400, 'invalid_code')],
      ['expired code', fail(410, 'code_expired')],
      ['no such account', fail(400, 'invalid_code', { attemptsRemaining: null })],
      ['too many attempts', fail(400, 'max_attempts')],
    ])('%s: one identical message, boxes cleared, focus back on the code', async (_name, result) => {
      confirm.mockResolvedValue(result);
      await toCodeStep();
      typeCode('123456');
      typePasswords('correct horse battery');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-error')).toBe("That code isn't valid or has expired. Check it, or request a new one."));
      expect(digits().every((d) => d.value === '')).toBe(true);
      expect(document.activeElement).toBe(digits()[0]);
      expect(handle.step()).toBe('code');
    });

    it('weak password from the server (422) keeps the code and points at the password', async () => {
      confirm.mockResolvedValue(fail(422, 'weak_password'));
      await toCodeStep();
      typeCode('123456');
      typePasswords('correct horse battery');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-error')).toBe("That password can't be used. Choose a different one."));
      expect(digits().map((d) => d.value).join('')).toBe('123456');
      expect(document.activeElement).toBe(q('#recover-password'));
    });

    it('429 on confirm: message, countdown on the button, no request while it runs', async () => {
      confirm.mockResolvedValue(fail(429, 'rate_limited', { retryAfter: 30 }));
      await toCodeStep();
      typeCode('123456');
      typePasswords('correct horse battery');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-submit')).toBe('Try again in 30s'));
      expect(text('#recover-error')).toBe('Too many requests. Try again in 30s.');
      expect(q<HTMLButtonElement>('#recover-submit').disabled).toBe(true);
      submitForm();
      expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('503 and network failures keep the form and let the user retry', async () => {
      confirm.mockResolvedValueOnce(fail(503, 'unavailable'));
      await toCodeStep();
      typeCode('123456');
      typePasswords('correct horse battery');
      submitForm();
      await vi.waitFor(() => expect(text('#recover-error')).toBe('Something went wrong. Please try again.'));
      expect(q<HTMLButtonElement>('#recover-submit').disabled).toBe(false);
      confirm.mockRejectedValueOnce(new AuthFlowNetworkError());
      submitForm();
      await vi.waitFor(() => expect(text('#recover-error')).toMatch(/reach the server/));
      confirm.mockResolvedValue(ok({ status: 200 }));
      submitForm();
      await vi.waitFor(() => expect(handle.step()).toBe('done'));
    });

    it('Resend is on cooldown right after sending, then sends again', async () => {
      await toCodeStep();
      const resend = q<HTMLButtonElement>('#recover-resend');
      expect(resend.disabled).toBe(true);
      expect(resend.textContent).toBe('Resend code in 60s');
      createCooldown(RECOVER_REQUEST_COOLDOWN).clear();
      resend.disabled = false;
      resend.click();
      resend.click();
      await vi.waitFor(() => expect(text('#recover-status')).toBe('We sent you a new code.'));
      expect(requestCode).toHaveBeenCalledTimes(2);
      expect(document.activeElement).toBe(digits()[0]);
    });

    it('Resend answered 429 shows the wait', async () => {
      await toCodeStep();
      createCooldown(RECOVER_REQUEST_COOLDOWN).clear();
      requestCode.mockResolvedValue(fail(429, 'rate_limited', { retryAfter: 45 }));
      q<HTMLButtonElement>('#recover-resend').disabled = false;
      q<HTMLButtonElement>('#recover-resend').click();
      await vi.waitFor(() => expect(text('#recover-error')).toMatch(/Too many requests\. Try again in (44|45)s\./));
    });

    it('"Use a different email" goes back with the field editable', async () => {
      await toCodeStep();
      q<HTMLButtonElement>('#recover-other-email').click();
      expect(handle.step()).toBe('email');
      expect(q<HTMLInputElement>('#recover-email').value).toBe('ana@example.com');
      expect(document.activeElement).toBe(q('h1'));
    });
  });

  it('destroy stops late responses from touching the page', async () => {
    let release!: (r: AuthFlowResult) => void;
    requestCode.mockReturnValue(new Promise<AuthFlowResult>((r) => { release = r; }));
    mount('ana@example.com');
    submitForm();
    handle.destroy();
    release(ok());
    await Promise.resolve();
    expect(q('#root').children).toHaveLength(0);
  });
});

describe('email prefill', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('accepts a plausible ?email= and removes it from the address bar', () => {
    window.history.replaceState(null, '', '/recover.html?email=ana%40example.com&x=1#top');
    expect(takeEmailPrefill()).toBe('ana@example.com');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#top');
  });

  it('ignores garbage and never reflects it', () => {
    window.history.replaceState(null, '', '/recover.html?email=%3Cscript%3E');
    expect(takeEmailPrefill()).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('no parameter, no prefill', () => {
    window.history.replaceState(null, '', '/recover.html');
    expect(takeEmailPrefill()).toBeNull();
  });

  it('isPlausibleEmail', () => {
    expect(isPlausibleEmail('a@b.co')).toBe(true);
    expect(isPlausibleEmail('a b@c.co')).toBe(false);
    expect(isPlausibleEmail('a@b')).toBe(false);
    expect(isPlausibleEmail(`${'a'.repeat(250)}@b.co`)).toBe(false);
  });
});
