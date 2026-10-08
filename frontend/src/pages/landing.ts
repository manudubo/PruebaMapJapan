/**
 * Landing page auth wiring.
 *
 * The hero is static HTML and is never hidden behind the auth check (it used to wait up to
 * ~10 s for keycloak-js when Keycloak was unreachable, and was the LCP element). The check
 * runs in the background:
 * - signed in       -> go to the dashboard (also when the answer arrives late)
 * - signed out      -> nothing to do (the hero already shows "Sign up" / "Sign in"), except
 *                      a notice when the user is back from a sign-up that did not complete
 * - unavailable     -> small dismissible notice with Retry; the page stays usable
 */

import { login } from '@/auth/keycloak';
import { watchAuth, showAuthNotice, hideAuthNotice, showSignUpNotice } from '@/auth/authStatusUI';
import { registrationEnabled, takeSignUpOutcome, wireSignUpButton } from '@/auth/registration';

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

  watchAuth({
    authenticated: () => {
      hideAuthNotice();
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
