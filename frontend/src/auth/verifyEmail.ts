/**
 * "Verify your email" screen shown after the first sign-in that follows a sign-up, while the
 * account's address is unverified (GET /api/users/me -> email_verified:false, or any API call
 * answering 403 email_not_verified).
 *
 * Same full-page pattern as the auth-unavailable state (src/auth/authStatusUI.ts): the page is
 * hidden (not removed), an <h1> section takes its place, and it carries its own `lang`.
 * The user types the 6-digit code that POST /auth/email-verify/request sent; on success the
 * token is refreshed (so it carries email_verified=true), other tabs are told, and the caller
 * continues (the dashboard goes on to the new-user passkey onboarding).
 *
 * Robustness: one submit at a time; "Resend code" cooldown persisted and shared by tabs
 * (src/modules/cooldown.ts), so a reload or a second tab never requests another code early;
 * 429/expired/locked/wrong-code/network each get their own message.
 */

import { authFormat, authLocale, authText, type AuthMessageKey } from './authMessages';
import { appPageUrl, forceRefreshToken, logout } from './keycloak';
import {
  AuthFlowNetworkError,
  classifyCodeProblem,
  confirmEmailVerification,
  requestEmailVerification,
  type AuthFlowResult,
} from '@/api/authFlows';
import { EMAIL_NOT_VERIFIED_EVENT } from '@/api/client';
import { createCodeInput } from '@/modules/codeInput';
import { createCooldown } from '@/modules/cooldown';
import { showToast } from '@/modules/toast';

export const VERIFY_SECTION_ID = 'verify-email';
/** Cooldown when the server does not say (it normally sends retryAfter). */
export const DEFAULT_RESEND_COOLDOWN_S = 60;
/** localStorage key (+ user id) another tab writes when it verified the address. */
export const VERIFIED_SIGNAL_PREFIX = 'travelmap.emailVerified.';

export interface VerifyEmailOptions {
  email: string | null;
  /** Keycloak subject: scopes the cooldown and the cross-tab signal to this account. */
  userKey: string;
}

interface Active {
  done: Promise<void>;
  destroy: () => void;
}

let active: Active | null = null;

export function isEmailVerificationShown(): boolean {
  return active !== null;
}

function mainEl(): HTMLElement {
  return document.getElementById('main-content') ?? document.querySelector('main') ?? document.body;
}

/**
 * Show the screen (or join the one already shown). Resolves once the address is verified
 * here or in another tab; the screen is then removed and the page restored.
 */
export function showEmailVerification(options: VerifyEmailOptions): Promise<void> {
  if (active) return active.done;

  const locale = authLocale();
  const t = (key: AuthMessageKey): string => authText(key, locale);
  const f = (key: AuthMessageKey, vars: Record<string, string | number>): string => authFormat(key, vars, locale);

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });

  // --- hide the page (restored on success) ---------------------------------
  const main = mainEl();
  for (const child of Array.from(main.children)) {
    if (child instanceof HTMLElement && !child.hidden) {
      child.hidden = true;
      child.dataset['verifyHidden'] = '';
    }
  }

  // --- build ------------------------------------------------------------------
  const section = document.createElement('section');
  section.className = 'page-card auth-unavailable verify-email';
  section.id = VERIFY_SECTION_ID;
  section.lang = locale;
  section.setAttribute('aria-labelledby', `${VERIFY_SECTION_ID}-title`);

  const h1 = document.createElement('h1');
  h1.id = `${VERIFY_SECTION_ID}-title`;
  h1.tabIndex = -1;
  h1.textContent = t('verifyTitle');

  const body = document.createElement('p');
  body.className = 'auth-unavailable-body';
  body.id = `${VERIFY_SECTION_ID}-body`;
  body.textContent = options.email ? f('verifyBody', { email: options.email }) : t('verifyBodyNoEmail');

  const form = document.createElement('form');
  form.className = 'verify-email-form';
  form.noValidate = true;

  const errorLine = document.createElement('p');
  errorLine.className = 'code-error';
  errorLine.id = `${VERIFY_SECTION_ID}-error`;
  errorLine.setAttribute('role', 'alert');

  let submitting = false;
  const code = createCodeInput({
    idPrefix: 'verify-code',
    legend: t('codeLegend'),
    digitLabel: (n) => f('codeDigit', { n }),
    describedBy: `${body.id} ${errorLine.id}`,
    onComplete: () => { void submit(); },
  });

  const verifyBtn = document.createElement('button');
  verifyBtn.type = 'submit';
  verifyBtn.className = 'btn btn-primary';
  verifyBtn.id = `${VERIFY_SECTION_ID}-submit`;
  verifyBtn.textContent = t('verifySubmit');

  const submitRow = document.createElement('div');
  submitRow.className = 'auth-unavailable-actions';
  submitRow.append(verifyBtn);
  form.append(code.element, errorLine, submitRow);

  const hint = document.createElement('p');
  hint.className = 'verify-email-hint';
  hint.textContent = t('spamHint');

  const resendBtn = document.createElement('button');
  resendBtn.type = 'button';
  resendBtn.className = 'btn btn-secondary';
  resendBtn.id = `${VERIFY_SECTION_ID}-resend`;

  const otherBtn = document.createElement('button');
  otherBtn.type = 'button';
  otherBtn.className = 'btn btn-link';
  otherBtn.id = `${VERIFY_SECTION_ID}-other-account`;
  otherBtn.textContent = t('otherAccount');

  const actions = document.createElement('div');
  actions.className = 'auth-unavailable-actions';
  actions.append(resendBtn, otherBtn);

  const statusLine = document.createElement('p');
  statusLine.className = 'auth-unavailable-status';
  statusLine.id = `${VERIFY_SECTION_ID}-status`;
  statusLine.setAttribute('role', 'status');

  section.append(h1, body, form, hint, actions, statusLine);
  main.prepend(section);

  // --- state --------------------------------------------------------------------
  const cooldown = createCooldown(`email-verify.${options.userKey}`);
  let sending = false;
  let finished = false;

  const renderResend = (): void => {
    const left = cooldown.remaining();
    resendBtn.disabled = sending || left > 0;
    resendBtn.textContent = left > 0 ? f('resendIn', { s: left }) : t('resendCode');
  };
  const timer = window.setInterval(renderResend, 1000);

  const showError = (message: string): void => {
    errorLine.textContent = message;
    code.setInvalid(message !== '');
  };

  const setSubmitting = (on: boolean): void => {
    submitting = on;
    verifyBtn.disabled = on;
    verifyBtn.textContent = on ? t('verifying') : t('verifySubmit');
    if (on) verifyBtn.setAttribute('aria-busy', 'true');
    else verifyBtn.removeAttribute('aria-busy');
    code.setDisabled(on);
  };

  const onStorage = (e: StorageEvent): void => {
    if (e.key === VERIFIED_SIGNAL_PREFIX + options.userKey && e.newValue) void finish(false);
  };
  window.addEventListener('storage', onStorage);

  const destroy = (): void => {
    window.clearInterval(timer);
    window.removeEventListener('storage', onStorage);
    section.remove();
    for (const child of Array.from(main.querySelectorAll<HTMLElement>('[data-verify-hidden]'))) {
      child.hidden = false;
      delete child.dataset['verifyHidden'];
    }
    active = null;
  };

  async function finish(here: boolean): Promise<void> {
    if (finished) return;
    finished = true;
    if (here) {
      try {
        window.localStorage.setItem(VERIFIED_SIGNAL_PREFIX + options.userKey, String(Date.now()));
      } catch {
        // Storage blocked: the other tab finds out on its next submit (alreadyVerified).
      }
    }
    // The new token carries email_verified=true, so the API stops answering 403.
    await forceRefreshToken();
    cooldown.clear();
    destroy();
    showToast(t('verified'), 'success');
    resolveDone();
  }

  async function send(initial: boolean): Promise<void> {
    if (cooldown.remaining() > 0 || sending) {
      renderResend();
      return;
    }
    sending = true;
    renderResend();
    let result: AuthFlowResult;
    try {
      result = await requestEmailVerification();
    } catch (err) {
      sending = false;
      renderResend();
      showError(err instanceof AuthFlowNetworkError ? t('networkError') : t('genericError'));
      return;
    }
    sending = false;
    if (result.ok) {
      cooldown.start(result.retryAfter ?? DEFAULT_RESEND_COOLDOWN_S);
      if (!initial) {
        showError('');
        statusLine.textContent = t('codeSent');
        code.focus(); // the Resend button just became disabled: keep the keyboard where it is useful
      }
    } else {
      const problem = classifyCodeProblem(result);
      if (problem === 'alreadyVerified') {
        await finish(true);
        return;
      }
      if (problem === 'rateLimited') {
        cooldown.start(result.retryAfter ?? DEFAULT_RESEND_COOLDOWN_S);
        // On load a 429 just means a code was sent moments ago (reload, other tab): no error.
        if (!initial) showError(f('rateLimited', { s: cooldown.remaining() }));
      } else {
        showError(t('genericError'));
      }
    }
    renderResend();
  }

  async function submit(): Promise<void> {
    if (submitting || finished) return;
    if (!code.isComplete()) {
      showError(t('codeIncomplete'));
      code.focus();
      return;
    }
    setSubmitting(true);
    statusLine.textContent = '';
    let result: AuthFlowResult;
    try {
      result = await confirmEmailVerification(code.value());
    } catch (err) {
      setSubmitting(false);
      showError(err instanceof AuthFlowNetworkError ? t('networkError') : t('genericError'));
      code.rearm();
      code.focus();
      return;
    }
    if (result.ok) {
      await finish(true);
      return;
    }
    setSubmitting(false);
    const problem = classifyCodeProblem(result);
    switch (problem) {
      case 'alreadyVerified':
        await finish(true);
        return;
      case 'wrong':
        showError(result.attemptsRemaining !== null
          ? f('codeWrongAttempts', { n: result.attemptsRemaining })
          : t('codeWrong'));
        code.clear();
        code.focus();
        return;
      case 'expired':
      case 'locked':
        showError(t(problem === 'expired' ? 'codeExpired' : 'codeLocked'));
        code.clear();
        renderResend();
        (resendBtn.disabled ? code.inputs[0]! : resendBtn).focus();
        return;
      case 'rateLimited':
        showError(f('rateLimited', { s: Math.ceil(result.retryAfter ?? 30) }));
        code.rearm();
        code.focus();
        return;
      default:
        showError(t('genericError'));
        code.rearm();
        code.focus();
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });
  resendBtn.addEventListener('click', () => { void send(false); });
  otherBtn.addEventListener('click', () => {
    otherBtn.disabled = true;
    logout(appPageUrl('index.html')).catch(() => { otherBtn.disabled = false; });
  });

  renderResend();
  code.focus();
  active = { done, destroy };
  void send(true);
  return done;
}

/**
 * Any later API call answering 403 email_not_verified (src/api/client.ts dispatches
 * EMAIL_NOT_VERIFIED_EVENT) shows the screen; once verified, `onVerified` runs (default:
 * reload, so the page fetches its data again with the new token). Returns an uninstaller.
 */
export function installEmailVerificationGate(
  context: () => VerifyEmailOptions | null,
  onVerified: () => void = () => window.location.reload(),
): () => void {
  const handler = (): void => {
    if (active) return;
    const ctx = context();
    if (!ctx) return;
    void showEmailVerification(ctx).then(onVerified);
  };
  window.addEventListener(EMAIL_NOT_VERIFIED_EVENT, handler);
  return () => window.removeEventListener(EMAIL_NOT_VERIFIED_EVENT, handler);
}

/** Test-only. */
export function __resetVerifyEmailForTests(): void {
  active?.destroy();
  active = null;
}
