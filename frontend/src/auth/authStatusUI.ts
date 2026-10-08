/**
 * Shared page-level handling of the Keycloak auth status.
 *
 * - watchAuth(): one subscription that calls the page's handler for the current status and
 *   again on every change (late success after a timeout, retry, coming back online).
 * - Auth-gated pages (dashboard, trip, profile) render a full "can't reach sign-in" state
 *   with an <h1>, Retry and a link home when Keycloak is unavailable.
 * - Public pages (landing) show a small, dismissible, non-blocking notice instead.
 * All DOM is built with textContent (no innerHTML) and carries its own `lang`.
 */

import {
  initKeycloak,
  retryAuth,
  getAuthStatus,
  getAuthUnavailableReason,
  onAuthStatusChange,
  type AuthStatus,
} from './keycloak';
import { authLocale, authText, type AuthMessageKey } from './authMessages';
import type { SignUpOutcome } from './registration';

export type AuthHandlers = Partial<Record<AuthStatus, () => void>>;

/**
 * Start (or join) the auth check and route every status to the page's handlers.
 * Handlers run on transitions only, so each is safe to write as "render this state".
 */
export function watchAuth(handlers: AuthHandlers): () => void {
  let last: AuthStatus | null = null;
  const dispatch = (next: AuthStatus): void => {
    if (next === last) return;
    last = next;
    handlers[next]?.();
  };
  const off = onAuthStatusChange(dispatch);
  const settle = (): void => dispatch(getAuthStatus());
  initKeycloak().then(settle, settle);
  return off;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; id?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  return node;
}

function t(key: AuthMessageKey): string {
  return authText(key, authLocale());
}

function unavailableBody(): string {
  return getAuthUnavailableReason() === 'offline' ? t('offlineBody') : t('unavailableBody');
}

function homeHref(): string {
  return new URL('index.html', window.location.href).href;
}

/**
 * Retry button behaviour shared by the full state and the notice: one attempt at a time
 * (retryAuth dedupes too), visible busy state, and a status line when it fails again.
 */
function wireRetry(button: HTMLButtonElement, statusLine: HTMLElement): void {
  button.addEventListener('click', () => {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = t('retrying');
    statusLine.textContent = '';
    retryAuth()
      .catch(() => {
        // Still unavailable: page stays as is; say so for screen readers too.
        if (button.isConnected) statusLine.textContent = t('stillUnavailable');
      })
      .finally(() => {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = t('retry');
      });
  });
}

// ---------------------------------------------------------------------------
// Full-page state (auth-gated pages)
// ---------------------------------------------------------------------------

const STATE_ID = 'auth-unavailable';
const PENDING_ID = 'auth-pending';

function mainEl(): HTMLElement {
  return document.getElementById('main-content') ?? document.querySelector('main') ?? document.body;
}

/** Replace the page content with the "can't reach the sign-in service" state. */
export function showAuthUnavailableState(): HTMLElement {
  hideAuthPending();
  const main = mainEl();
  const existing = document.getElementById(STATE_ID);
  if (existing) {
    const body = existing.querySelector('.auth-unavailable-body');
    if (body) body.textContent = unavailableBody();
    return existing;
  }

  // Hide (not delete) the page so a late sign-in can restore it untouched.
  for (const child of Array.from(main.children)) {
    if (child instanceof HTMLElement && !child.hidden) {
      child.hidden = true;
      child.dataset['authHidden'] = '';
    }
  }

  const section = el('section', { className: 'page-card auth-unavailable', id: STATE_ID });
  section.setAttribute('aria-labelledby', `${STATE_ID}-title`);
  section.lang = authLocale();

  const alert = el('div');
  alert.setAttribute('role', 'alert');
  const heading = el('h1', { id: `${STATE_ID}-title`, text: t('unavailableTitle') });
  heading.tabIndex = -1;
  alert.append(heading, el('p', { className: 'auth-unavailable-body', text: unavailableBody() }));

  const actions = el('div', { className: 'auth-unavailable-actions' });
  const retry = el('button', { className: 'btn btn-primary', text: t('retry') });
  retry.type = 'button';
  retry.id = `${STATE_ID}-retry`;
  const home = el('a', { className: 'btn btn-secondary', text: t('home') });
  home.href = homeHref();
  actions.append(retry, home);

  const statusLine = el('p', { className: 'auth-unavailable-status' });
  statusLine.setAttribute('role', 'status');

  section.append(alert, actions, statusLine);
  main.prepend(section);
  wireRetry(retry, statusLine);
  return section;
}

/** Remove the unavailable state and restore whatever it hid. */
export function clearAuthUnavailableState(): void {
  document.getElementById(STATE_ID)?.remove();
  for (const child of Array.from(mainEl().querySelectorAll<HTMLElement>('[data-auth-hidden]'))) {
    child.hidden = false;
    delete child.dataset['authHidden'];
  }
}

/** Small, bounded "Checking sign-in…" line while the first check runs. */
export function showAuthPending(): void {
  if (document.getElementById(PENDING_ID) || document.getElementById(STATE_ID)) return;
  const line = el('p', { className: 'auth-pending', id: PENDING_ID, text: t('checking') });
  line.setAttribute('role', 'status');
  line.lang = authLocale();
  mainEl().prepend(line);
}

export function hideAuthPending(): void {
  document.getElementById(PENDING_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Non-blocking notice (public pages)
// ---------------------------------------------------------------------------

const NOTICE_ID = 'auth-notice';
let noticeDismissed = false;

export function showAuthNotice(): void {
  if (noticeDismissed || document.getElementById(NOTICE_ID)) return;

  const notice = el('div', { className: 'auth-notice', id: NOTICE_ID });
  notice.setAttribute('role', 'status');
  notice.lang = authLocale();

  const text = el('p', { className: 'auth-notice-text', text: t('notice') });
  const statusLine = el('span', { className: 'auth-notice-status' });
  text.append(' ', statusLine);

  const retry = el('button', { className: 'btn btn-secondary btn-small auth-notice-retry', text: t('retry') });
  retry.type = 'button';
  const dismiss = el('button', { className: 'auth-notice-dismiss', text: '×' });
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', t('dismiss'));
  dismiss.addEventListener('click', () => {
    noticeDismissed = true;
    notice.remove();
  });

  notice.append(text, retry, dismiss);
  mainEl().prepend(notice);
  wireRetry(retry, statusLine);
}

export function hideAuthNotice(): void {
  document.getElementById(NOTICE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Sign-up outcome notice (public pages and the dashboard prompt)
// ---------------------------------------------------------------------------

const SIGNUP_NOTICE_ID = 'signup-notice';

const SIGNUP_NOTICE_KEYS: Partial<Record<SignUpOutcome | 'unavailable', AuthMessageKey>> = {
  cancelled: 'signupCancelled',
  refused: 'signupUnavailable',
  incomplete: 'signupIncomplete',
  unavailable: 'signupUnavailable',
};

/**
 * Small, dismissible notice after a sign-up that did not complete (or could not start).
 * Same look as the auth notice; nothing for 'none'/'completed'. Returns the notice or null.
 */
export function showSignUpNotice(outcome: SignUpOutcome | 'unavailable'): HTMLElement | null {
  const key = SIGNUP_NOTICE_KEYS[outcome];
  if (!key) return null;
  document.getElementById(SIGNUP_NOTICE_ID)?.remove();

  const notice = el('div', { className: 'auth-notice', id: SIGNUP_NOTICE_ID });
  notice.setAttribute('role', 'status');
  notice.lang = authLocale();
  notice.dataset['outcome'] = outcome;
  const text = el('p', { className: 'auth-notice-text', text: t(key) });
  const dismiss = el('button', { className: 'auth-notice-dismiss', text: '×' });
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', t('dismiss'));
  dismiss.addEventListener('click', () => notice.remove());
  notice.append(text, dismiss);
  mainEl().prepend(notice);
  return notice;
}

/** Test-only. */
export function __resetAuthUIForTests(): void {
  noticeDismissed = false;
}
