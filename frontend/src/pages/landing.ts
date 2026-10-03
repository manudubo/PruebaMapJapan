/**
 * Landing page auth wiring.
 *
 * The hero is static HTML and is never hidden behind the auth check (it used to wait up to
 * ~10 s for keycloak-js when Keycloak was unreachable, and was the LCP element). The check
 * runs in the background:
 * - signed in       -> go to the dashboard (also when the answer arrives late)
 * - signed out      -> nothing to do (the hero already shows "Sign in")
 * - unavailable     -> small dismissible notice with Retry; the page stays usable
 */

import { login } from '@/auth/keycloak';
import { watchAuth, showAuthNotice, hideAuthNotice } from '@/auth/authStatusUI';

export function initLanding(
  navigate: (url: string) => void = (url) => window.location.replace(url),
): void {
  const loginBtn = document.getElementById('landing-login-btn');
  loginBtn?.addEventListener('click', () => {
    login(new URL('dashboard.html', window.location.href).href).catch((err: unknown) => {
      console.warn('[auth] could not start sign-in', err);
      showAuthNotice();
    });
  });

  watchAuth({
    authenticated: () => {
      hideAuthNotice();
      navigate(new URL('dashboard.html', window.location.href).href);
    },
    anonymous: hideAuthNotice,
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
