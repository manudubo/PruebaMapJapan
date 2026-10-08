import '@/styles/main.css';
import '@/components/Navbar';

import { initTheme } from '@/modules/theme';
import { showToast, installGlobalErrorHandler } from '@/modules/toast';
import {
  watchAuth,
  showAuthUnavailableState,
  clearAuthUnavailableState,
} from '@/auth/authStatusUI';
import { getTrip } from '@/api/client';
import { login } from '@/auth/keycloak';
import { initMetadataSection } from './trip-edit/metadata';
import { initDestinationsSection } from './trip-edit/destinations';

/**
 * Trip editor bootstrap.
 *
 * Auth goes through the shared watchAuth handling (review S1), like dashboard,
 * trip and profile: initKeycloak() gives up after AUTH_INIT_TIMEOUT_MS, and
 * that must not read as "signed out". So:
 * - authenticated -> load the trip (once, also when the answer arrives late)
 * - anonymous     -> sign in, then back to this editor (trip-edit.html?tripId=N;
 *                    login() sends Keycloak a registered redirect URI and
 *                    restores the query after the callback); without a
 *                    tripId, or if the redirect cannot start, the dashboard
 * - unavailable   -> "can't reach sign-in" state with Retry; no redirect
 */
export function initTripEdit(
  navigate: (url: string) => void = (url) => window.location.replace(url),
): void {
  initTheme();
  installGlobalErrorHandler();

  const tripId = new URLSearchParams(window.location.search).get('tripId');
  const dashboardUrl = new URL('dashboard.html', window.location.href).href;

  let handled = false;
  watchAuth({
    authenticated: () => {
      clearAuthUnavailableState();
      if (handled) return;
      handled = true;
      if (!tripId) {
        navigate(dashboardUrl);
        return;
      }
      void loadEditor(tripId, () => navigate(dashboardUrl));
    },
    anonymous: () => {
      clearAuthUnavailableState();
      if (handled) return;
      handled = true;
      if (!tripId) {
        navigate(dashboardUrl);
        return;
      }
      login().catch(() => navigate(dashboardUrl));
    },
    unavailable: () => {
      if (handled) return;
      showAuthUnavailableState();
      // The page fades in on body.ready (FOUC guard); the error must be visible.
      document.body.classList.add('ready');
    },
  });
}

async function loadEditor(tripId: string, backToDashboard: () => void): Promise<void> {
  try {
    const trip = await getTrip(tripId);
    initMetadataSection(trip);
    initDestinationsSection(trip, tripId);
    document.getElementById('destinations-section')?.removeAttribute('hidden');
    document.body.classList.add('ready');
  } catch {
    showToast('Could not load trip — returning to dashboard', 'error');
    setTimeout(backToDashboard, 1500);
  }
}

if (!import.meta.env.VITEST) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initTripEdit());
  } else {
    initTripEdit();
  }
}
