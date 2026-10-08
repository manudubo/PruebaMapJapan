/**
 * Landing page auth wiring.
 *
 * The hero is static HTML and is never hidden behind the auth check (it used to wait up to
 * ~10 s for keycloak-js when Keycloak was unreachable, and was the LCP element). The check
 * runs in the background:
 * - signed in       -> go to the dashboard (also when the answer arrives late), unless the
 *                      visitor came through an in-app Home link (?home): then stay
 * - signed out      -> nothing to do (the hero already shows "Sign up" / "Sign in"), except
 *                      a notice when the user is back from a sign-up that did not complete
 * - unavailable     -> small dismissible notice with Retry; the page stays usable
 */

import { login, isHomeIntent } from '@/auth/keycloak';
import { watchAuth, showAuthNotice, hideAuthNotice, showSignUpNotice } from '@/auth/authStatusUI';
import { registrationEnabled, takeSignUpOutcome, wireSignUpButton } from '@/auth/registration';

/** Signed in on purpose here: "Sign in" becomes a plain link-like button to the dashboard. */
function showDashboardShortcut(
  loginBtn: HTMLElement | null,
  signupBtn: HTMLElement | null,
  dashboardUrl: string,
): void {
  signupBtn?.setAttribute('hidden', '');
  if (!loginBtn) return;
  loginBtn.textContent = 'Go to dashboard';
  loginBtn.setAttribute('data-signed-in', '');
  loginBtn.addEventListener('click', (e) => {
    e.stopImmediatePropagation();
    window.location.assign(dashboardUrl);
  }, true);
}

export function initLanding(
  navigate: (url: string) => void = (url) => window.location.replace(url),
): void {
  const dashboardUrl = new URL('dashboard.html', window.location.href).href;
  const loginBtn = document.getElementById('landing-login-btn');
  loginBtn?.addEventListener('click', () => {
    login(dashboardUrl).catch((err: unknown) => {
      console.warn('[auth] could not start sign-in', err);
      showAuthNotice();
    });
  });

  const signupBtn = document.getElementById('landing-signup-btn');
  if (registrationEnabled()) {
    wireSignUpButton(signupBtn, (err) => {
      console.warn('[auth] could not start sign-up', err);
      showSignUpNotice('unavailable');
    }, dashboardUrl);
  } else {
    signupBtn?.setAttribute('hidden', '');
  }

  const stay = isHomeIntent();
  watchAuth({
    authenticated: () => {
      hideAuthNotice();
      // A Home link (?home) means the visitor chose this page: stay, offer the dashboard.
      if (stay) {
        showDashboardShortcut(loginBtn, signupBtn, dashboardUrl);
        return;
      }
      navigate(dashboardUrl);
    },
    anonymous: () => {
      hideAuthNotice();
      showSignUpNotice(takeSignUpOutcome(false));
    },
    unavailable: showAuthNotice,
  });
}

if (!import.meta.env.VITEST) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initLanding());
  } else {
    initLanding();
  }
}
