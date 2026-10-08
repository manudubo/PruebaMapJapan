/**
 * Account recovery view (recover.html): email -> code + new password -> done.
 *
 * For a user who cannot use their passkey (lost device, unsupported browser). The server sends
 * a 6-digit code to the address and, with the code, sets a password. Rules that matter:
 *
 * - Anti-enumeration: whether or not an account exists for the address, the user sees the same
 *   screen and the same words ("If an account exists for … we sent a code"), and a wrong or
 *   expired code says the same thing for both. Nothing here depends on the server revealing
 *   it.
 * - Secrets never go in the URL: the code and the password are only ever in the request body.
 *   The optional `?email=` prefill is read once and removed from the address bar.
 * - Rate limits (429) show a visible, persisted countdown; one request at a time per button.
 *
 * Everything is built with textContent (no innerHTML); the container carries its own `lang`.
 */

import { authFormat, authLocale, authText, type AuthLocale, type AuthMessageKey } from '@/auth/authMessages';
import {
  AuthFlowNetworkError,
  classifyCodeProblem,
  confirmRecovery,
  requestRecoveryCode,
  type AuthFlowResult,
} from '@/api/authFlows';
import { allMet, checkPassword, MAX_PASSWORD_LENGTH, type PasswordRuleId } from '@/auth/passwordRules';
import { createCodeInput, type CodeInput } from '@/modules/codeInput';
import { createCooldown } from '@/modules/cooldown';

export const RECOVER_REQUEST_COOLDOWN = 'recovery.request';
export const RECOVER_CONFIRM_COOLDOWN = 'recovery.confirm';
/** Used when a 2xx/429 does not say how long to wait. */
export const DEFAULT_COOLDOWN_S = 60;

export type RecoverStep = 'email' | 'code' | 'done';

export interface RecoverDeps {
  requestCode: (email: string) => Promise<AuthFlowResult>;
  confirm: (email: string, code: string, password: string) => Promise<AuthFlowResult>;
  signIn: () => void;
  locale?: AuthLocale;
}

export interface RecoverHandle {
  step(): RecoverStep;
  destroy(): void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** The `?email=` prefill, validated; the query string is removed from the address bar. */
export function takeEmailPrefill(): string | null {
  let email: string | null = null;
  try {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('email');
    if (url.searchParams.has('email')) {
      url.searchParams.delete('email');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
    email = raw !== null && isPlausibleEmail(raw.trim()) ? raw.trim() : null;
  } catch {
    // no URL support: no prefill
  }
  return email;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; id?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (props.className) n.className = props.className;
  if (props.id) n.id = props.id;
  if (props.text !== undefined) n.textContent = props.text;
  return n;
}

export function mountRecover(
  root: HTMLElement,
  options: { prefillEmail?: string | null } = {},
  deps: Partial<RecoverDeps> = {},
): RecoverHandle {
  const locale = deps.locale ?? authLocale();
  const t = (key: AuthMessageKey): string => authText(key, locale);
  const f = (key: AuthMessageKey, vars: Record<string, string | number>): string => authFormat(key, vars, locale);
  const requestCode = deps.requestCode ?? requestRecoveryCode;
  const confirm = deps.confirm ?? confirmRecovery;
  const signIn =
    deps.signIn ??
    ((): void => {
      void import('@/auth/keycloak').then((kc) => kc.login());
    });

  const requestCooldown = createCooldown(RECOVER_REQUEST_COOLDOWN);
  const confirmCooldown = createCooldown(RECOVER_CONFIRM_COOLDOWN);
  let current: RecoverStep = 'email';
  let email = options.prefillEmail ?? '';
  let timer: number | null = null;
  let destroyed = false;

  root.lang = locale;

  const setTicker = (fn: (() => void) | null): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    if (fn) {
      fn();
      timer = window.setInterval(fn, 1000);
    }
  };

  const reset = (): void => {
    setTicker(null);
    root.replaceChildren();
  };

  const heading = (text: string): HTMLHeadingElement => {
    const h1 = node('h1', { text });
    h1.tabIndex = -1;
    return h1;
  };

  /** Send (or re-send) the code. Shared by the email form and "Resend code". */
  async function send(address: string): Promise<AuthFlowResult | 'network' | 'blocked'> {
    if (requestCooldown.remaining() > 0) return 'blocked';
    let result: AuthFlowResult;
    try {
      result = await requestCode(address);
    } catch (err) {
      if (err instanceof AuthFlowNetworkError) return 'network';
      throw err;
    }
    if (result.ok || result.status === 404) {
      // Always the same outcome, whether or not the account exists.
      requestCooldown.start(result.retryAfter ?? DEFAULT_COOLDOWN_S);
    } else if (result.status === 429) {
      requestCooldown.start(result.retryAfter ?? DEFAULT_COOLDOWN_S);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Step 1: email
  // -------------------------------------------------------------------------
  function renderEmail(focusHeading = false): void {
    reset();
    current = 'email';
    const h1 = heading(t('recoverTitle'));
    const intro = node('p', { className: 'recover-intro', text: t('recoverIntro'), id: 'recover-intro' });

    const form = node('form', { className: 'recover-form' });
    form.noValidate = true;
    const group = node('div', { className: 'form-group' });
    const label = node('label', { text: t('emailLabel') });
    label.htmlFor = 'recover-email';
    const input = node('input', { id: 'recover-email' });
    input.type = 'email';
    input.name = 'email';
    input.autocomplete = 'email';
    input.inputMode = 'email';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.required = true;
    input.value = email;
    const error = node('p', { className: 'code-error', id: 'recover-email-error' });
    error.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', `recover-intro ${error.id}`);
    group.append(label, input);

    const submit = node('button', { className: 'btn btn-primary', id: 'recover-send' });
    submit.type = 'submit';
    form.append(group, error, submit);

    let busy = false;
    const renderSubmit = (): void => {
      const left = requestCooldown.remaining();
      submit.disabled = busy || left > 0;
      submit.textContent = busy ? t('sending') : left > 0 ? f('sendCodeIn', { s: left }) : t('sendCode');
      if (busy) submit.setAttribute('aria-busy', 'true');
      else submit.removeAttribute('aria-busy');
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy || destroyed) return;
      const value = input.value.trim();
      if (!isPlausibleEmail(value)) {
        error.textContent = t('invalidEmail');
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      error.textContent = '';
      email = value;
      busy = true;
      renderSubmit();
      void send(value).then((outcome) => {
        busy = false;
        if (destroyed) return;
        if (outcome === 'blocked') {
          renderSubmit();
        } else if (outcome === 'network') {
          error.textContent = t('networkError');
          renderSubmit();
        } else if (outcome.status === 429) {
          error.textContent = f('rateLimited', { s: requestCooldown.remaining() });
          renderSubmit();
        } else if (outcome.ok || outcome.status === 404) {
          renderCode();
        } else if (outcome.status === 400 || outcome.status === 422) {
          error.textContent = t('invalidEmail');
          input.setAttribute('aria-invalid', 'true');
          renderSubmit();
          input.focus();
        } else {
          error.textContent = t('genericError');
          renderSubmit();
        }
      });
    });

    root.append(h1, intro, form);
    setTicker(renderSubmit);
    if (focusHeading) h1.focus();
  }

  // -------------------------------------------------------------------------
  // Step 2: code + new password
  // -------------------------------------------------------------------------
  function renderCode(): void {
    reset();
    current = 'code';
    const h1 = heading(t('recoverTitle'));
    const sent = node('p', { className: 'recover-intro', id: 'recover-sent', text: f('recoverSent', { email }) });
    sent.setAttribute('role', 'status');

    const form = node('form', { className: 'recover-form' });
    form.noValidate = true;
    const error = node('p', { className: 'code-error', id: 'recover-error' });
    error.setAttribute('role', 'alert');

    let busy = false;
    const codeInput: CodeInput = createCodeInput({
      idPrefix: 'recover-code',
      legend: t('codeLegend'),
      digitLabel: (n) => f('codeDigit', { n }),
      describedBy: `${sent.id} ${error.id}`,
      onComplete: () => passwordInput.focus(),
    });

    const pwGroup = node('div', { className: 'form-group' });
    const pwLabel = node('label', { text: t('newPassword') });
    pwLabel.htmlFor = 'recover-password';
    const passwordInput = node('input', { id: 'recover-password' });
    passwordInput.type = 'password';
    passwordInput.name = 'new-password';
    passwordInput.autocomplete = 'new-password';
    passwordInput.maxLength = MAX_PASSWORD_LENGTH * 2; // UTF-16 units; the rule counts code points
    pwGroup.append(pwLabel, passwordInput);

    const confirmGroup = node('div', { className: 'form-group' });
    const confirmLabel = node('label', { text: t('confirmPassword') });
    confirmLabel.htmlFor = 'recover-confirm';
    const confirmInput = node('input', { id: 'recover-confirm' });
    confirmInput.type = 'password';
    confirmInput.name = 'confirm-password';
    confirmInput.autocomplete = 'new-password';
    confirmInput.maxLength = MAX_PASSWORD_LENGTH * 2;
    confirmGroup.append(confirmLabel, confirmInput);

    const toggle = node('button', { className: 'btn btn-link recover-toggle', id: 'recover-toggle', text: t('show') });
    toggle.type = 'button';
    toggle.setAttribute('aria-label', t('showPassword'));
    toggle.setAttribute('aria-controls', `${passwordInput.id} ${confirmInput.id}`);
    toggle.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      confirmInput.type = show ? 'text' : 'password';
      toggle.textContent = show ? t('hide') : t('show');
      toggle.setAttribute('aria-label', show ? t('hidePassword') : t('showPassword'));
    });

    // Live checklist: each item announces its own change (aria-live on the list), the status
    // is words as well as an icon so it does not rely on color.
    const rulesBox = node('div', { className: 'pw-rules' });
    const rulesTitle = node('p', { className: 'pw-rules-title', id: 'recover-rules-title', text: t('rulesHeading') });
    const rulesList = node('ul', { id: 'recover-rules' });
    rulesList.setAttribute('aria-labelledby', rulesTitle.id);
    rulesList.setAttribute('aria-live', 'polite');
    const ruleText: Record<PasswordRuleId, AuthMessageKey> = {
      length: 'ruleLength',
      notEmail: 'ruleNotEmail',
      match: 'ruleMatch',
    };
    const ruleItems = new Map<PasswordRuleId, { li: HTMLLIElement; state: HTMLSpanElement }>();
    for (const id of Object.keys(ruleText) as PasswordRuleId[]) {
      const li = node('li', { className: 'pw-rule' });
      li.dataset['rule'] = id;
      const icon = node('span', { className: 'pw-rule-icon' });
      icon.setAttribute('aria-hidden', 'true');
      const label = node('span', { text: t(ruleText[id]) });
      const state = node('span', { className: 'sr-only' });
      li.append(icon, label, state);
      rulesList.appendChild(li);
      ruleItems.set(id, { li, state });
    }
    rulesBox.append(rulesTitle, rulesList);

    const renderRules = (): boolean => {
      const results = checkPassword(passwordInput.value, confirmInput.value, email);
      for (const r of results) {
        const item = ruleItems.get(r.id)!;
        const next = r.met ? 'met' : 'unmet';
        if (item.li.dataset['state'] !== next) {
          item.li.dataset['state'] = next;
          item.li.classList.toggle('pw-rule--met', r.met);
          item.li.firstElementChild!.textContent = r.met ? '✓' : '○';
          item.state.textContent = ` (${t(r.met ? 'ruleMet' : 'ruleUnmet')})`;
        }
      }
      return allMet(results);
    };
    passwordInput.addEventListener('input', renderRules);
    confirmInput.addEventListener('input', renderRules);

    const submit = node('button', { className: 'btn btn-primary', id: 'recover-submit', text: t('setPassword') });
    submit.type = 'submit';

    const renderSubmit = (): void => {
      const left = confirmCooldown.remaining();
      submit.disabled = busy || left > 0;
      submit.textContent = busy ? t('saving') : left > 0 ? f('retryIn', { s: left }) : t('setPassword');
    };

    const setBusy = (on: boolean): void => {
      busy = on;
      renderSubmit();
      if (on) submit.setAttribute('aria-busy', 'true');
      else submit.removeAttribute('aria-busy');
      codeInput.setDisabled(on);
      passwordInput.disabled = on;
      confirmInput.disabled = on;
    };

    const fail = (message: string, focus: HTMLElement): void => {
      error.textContent = message;
      focus.focus();
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy || destroyed || confirmCooldown.remaining() > 0) return;
      error.textContent = '';
      if (!codeInput.isComplete()) {
        codeInput.setInvalid(true);
        return fail(t('codeIncomplete'), codeInput.inputs[codeInput.inputs.findIndex((x) => x.value === '')]!);
      }
      if (!renderRules()) {
        codeInput.setInvalid(false);
        return fail(t('passwordUnmet'), passwordInput.value === '' ? passwordInput : confirmInput.value === passwordInput.value ? passwordInput : confirmInput);
      }
      codeInput.setInvalid(false);
      setBusy(true);
      confirm(email, codeInput.value(), passwordInput.value).then(
        (result) => {
          if (destroyed) return;
          if (result.ok) {
            // Do not keep the secrets in the DOM any longer than needed.
            passwordInput.value = '';
            confirmInput.value = '';
            renderDone();
            return;
          }
          setBusy(false);
          const problem = classifyCodeProblem(result);
          if (problem === 'rateLimited') {
            confirmCooldown.start(result.retryAfter ?? 30);
            codeInput.rearm();
            renderSubmit();
            fail(f('rateLimited', { s: Math.ceil(result.retryAfter ?? 30) }), passwordInput);
          } else if (problem === 'password') {
            fail(t('passwordRejected'), passwordInput);
          } else if (problem === 'wrong' || problem === 'expired' || problem === 'locked') {
            // One message for all of them (and for an address with no account).
            codeInput.clear();
            codeInput.setInvalid(true);
            fail(t('recoverCodeInvalid'), codeInput.inputs[0]!);
          } else {
            codeInput.rearm();
            fail(t('genericError'), submit);
          }
        },
        (err: unknown) => {
          if (destroyed) return;
          setBusy(false);
          codeInput.rearm();
          fail(err instanceof AuthFlowNetworkError ? t('networkError') : t('genericError'), submit);
        },
      );
    });

    // Secondary actions
    const resend = node('button', { className: 'btn btn-secondary', id: 'recover-resend' });
    resend.type = 'button';
    const status = node('p', { className: 'auth-unavailable-status', id: 'recover-status' });
    status.setAttribute('role', 'status');
    let resending = false;
    const renderResend = (): void => {
      const left = requestCooldown.remaining();
      resend.disabled = resending || left > 0;
      resend.textContent = left > 0 ? f('resendIn', { s: left }) : t('resendCode');
    };
    resend.addEventListener('click', () => {
      if (resending || destroyed) return;
      resending = true;
      renderResend();
      void send(email).then((outcome) => {
        resending = false;
        if (destroyed) return;
        if (outcome === 'network') error.textContent = t('networkError');
        else if (outcome !== 'blocked' && outcome.status === 429) error.textContent = f('rateLimited', { s: requestCooldown.remaining() });
        else if (outcome !== 'blocked' && !outcome.ok) error.textContent = t('genericError');
        else if (outcome !== 'blocked') {
          error.textContent = '';
          status.textContent = t('codeSent');
          codeInput.focus();
        }
        renderResend();
      });
    });
    const other = node('button', { className: 'btn btn-link', id: 'recover-other-email', text: t('differentEmail') });
    other.type = 'button';
    other.addEventListener('click', () => {
      if (!busy) renderEmail(true);
    });
    const actions = node('div', { className: 'auth-unavailable-actions recover-actions' });
    actions.append(resend, other);

    form.append(codeInput.element, pwGroup, confirmGroup, toggle, rulesBox, error, submit);
    root.append(h1, sent, form, actions, status);
    renderRules();
    setTicker(() => {
      renderResend();
      renderSubmit();
    });
    codeInput.focus();
  }

  // -------------------------------------------------------------------------
  // Step 3: done
  // -------------------------------------------------------------------------
  function renderDone(): void {
    reset();
    current = 'done';
    requestCooldown.clear();
    confirmCooldown.clear();
    const h1 = heading(t('recoverDoneTitle'));
    const body = node('p', { className: 'recover-intro', text: t('recoverDoneBody') });
    body.setAttribute('role', 'status');
    const btn = node('button', { className: 'btn btn-primary', id: 'recover-signin', text: t('signIn') });
    btn.type = 'button';
    let starting = false;
    btn.addEventListener('click', () => {
      if (starting) return;
      starting = true;
      btn.disabled = true;
      signIn();
    });
    root.append(h1, body, btn);
    h1.focus();
  }

  renderEmail();

  return {
    step: () => current,
    destroy() {
      destroyed = true;
      setTicker(null);
      root.replaceChildren();
    },
  };
}
