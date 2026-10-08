/**
 * Self-registration ("Sign up").
 *
 * - registrationEnabled(): build-time gate. VITE_REGISTRATION_ENABLED=false turns it off;
 *   otherwise it is on whenever a real Keycloak is configured (VITE_KEYCLOAK_URL). Demo-only
 *   builds have no Keycloak, so they never show "Sign up". The HTML buttons are gated at
 *   build time too (build/signupGatePlugin.ts), so nothing shifts after the script runs.
 * - signUp(): starts keycloak-js register() once (double clicks and Enter repeats are
 *   ignored until the page is left or restored from the back/forward cache) and remembers
 *   that a sign-up is in flight.
 * - takeSignUpOutcome(): on the page Keycloak sends the user back to, tells whether that
 *   sign-up completed, was cancelled, or was refused (the realm can turn registration off,
 *   in which case Keycloak shows its own error page and the user comes back without a code).
 */

import { register, getLoginCallbackError, appPageUrl } from './keycloak';

export interface RegistrationEnv {
  flag: string | undefined;
  keycloakUrl: string | undefined;
}

export function registrationEnabled(
  env: RegistrationEnv = {
    flag: import.meta.env['VITE_REGISTRATION_ENABLED'] as string | undefined,
    keycloakUrl: import.meta.env['VITE_KEYCLOAK_URL'] as string | undefined,
  },
): boolean {
  const flag = (env.flag ?? '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  if (flag === 'true' || flag === '1' || flag === 'on') return true;
  return (env.keycloakUrl ?? '').trim() !== '';
}

export const SIGNUP_PENDING_KEY = 'travelmap.auth.signupPending';
/** A pending marker older than this belongs to an abandoned sign-up. */
export const SIGNUP_PENDING_TTL_MS = 30 * 60 * 1000;

let starting = false;
let pageshowArmed = false;

function armPageshowReset(): void {
  if (pageshowArmed || typeof window === 'undefined') return;
  pageshowArmed = true;
  // Back button after the redirect started: the page comes back from the bfcache with
  // `starting` still true and the button would be dead.
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) starting = false;
  });
}

function setPending(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(SIGNUP_PENDING_KEY, String(Date.now()));
    else window.sessionStorage.removeItem(SIGNUP_PENDING_KEY);
  } catch {
    // Storage blocked: sign-up still works, only the "didn't complete" notice is lost.
  }
}

function pendingSince(): number | null {
  try {
    const raw = window.sessionStorage.getItem(SIGNUP_PENDING_KEY);
    const at = raw === null ? NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * Send the user to the realm's registration page. Resolves false (and does nothing) when
 * a sign-up is already starting; rejects when keycloak-js could not start it.
 */
export async function signUp(target: string = appPageUrl('dashboard.html')): Promise<boolean> {
  if (starting) return false;
  starting = true;
  armPageshowReset();
  setPending(true);
  try {
    await register(target);
    return true;
  } catch (err) {
    starting = false;
    setPending(false);
    throw err;
  }
}

/** Wire a "Sign up" button: busy state while redirecting, `onError` when it can't start. */
export function wireSignUpButton(
  button: HTMLElement | null | undefined,
  onError: (err: unknown) => void,
  target?: string,
): void {
  if (!button || button.dataset['signupWired']) return;
  button.dataset['signupWired'] = '1';
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.setAttribute('aria-disabled', 'true');
    signUp(target)
      .then((started) => {
        if (!started) return;
        // Restored from the bfcache: let the user try again.
        window.addEventListener('pageshow', () => button.removeAttribute('aria-disabled'), { once: true });
      })
      .catch((err: unknown) => {
        button.removeAttribute('aria-disabled');
        onError(err);
      });
  });
}

export type SignUpOutcome = 'none' | 'completed' | 'cancelled' | 'refused' | 'incomplete';

/**
 * Call once auth settled ('authenticated' or 'anonymous'). Consumes the pending marker.
 * - 'none': no sign-up was in flight (or it is too old to matter).
 * - 'completed': the user is signed in.
 * - 'cancelled': Keycloak returned error=access_denied (the user backed out).
 * - 'refused': Keycloak returned another OAuth error (e.g. registration not allowed).
 * - 'incomplete': back without any answer (Keycloak error page, browser Back).
 */
export function takeSignUpOutcome(authenticated: boolean, now: number = Date.now()): SignUpOutcome {
  const since = pendingSince();
  setPending(false);
  starting = false;
  if (since === null || now - since > SIGNUP_PENDING_TTL_MS || since > now + 60_000) return 'none';
  if (authenticated) return 'completed';
  const error = getLoginCallbackError();
  if (error === 'access_denied') return 'cancelled';
  if (error) return 'refused';
  return 'incomplete';
}

/** Test-only. */
export function __resetRegistrationForTests(): void {
  starting = false;
}
