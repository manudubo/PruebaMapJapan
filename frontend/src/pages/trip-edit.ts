import '@/styles/main.css';
import '@/styles/trip-edit.css';
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
import { mountEditor } from './trip-edit/app';

/**
 * Trip editor bootstrap.
 *
 * Auth goes through the shared watchAuth handling (review S1), like dashboard,
 * trip and profile: initKeycloak() gives up after AUTH_INIT_TIMEOUT_MS, and
 * that must not read as "signed out". So:
 * - authenticated -> open the editor (once, also when the answer arrives late):
 *                    `?tripId=N` loads that trip, `?new=1` starts a new one
 * - anonymous     -> sign in, then back to this editor (trip-edit.html?tripId=N;
 *                    login() sends Keycloak a registered redirect URI and
 *                    restores the query after the callback); without a
 *                    tripId (or ?new=1), or if the redirect cannot start, the
 *                    dashboard
 * - unavailable   -> "can't reach sign-in" state with Retry; no redirect
 */
export function initTripEdit(
  navigate: (url: string) => void = (url) => window.location.replace(url),
): void {
  initTheme();
  installGlobalErrorHandler();

  const params = new URLSearchParams(window.location.search);
  const tripId = params.get('tripId');
  const isNew = !tripId && params.get('new') === '1';
  const dashboardUrl = new URL('dashboard.html', window.location.href).href;

  let handled = false;
  watchAuth({
    authenticated: () => {
      clearAuthUnavailableState();
      if (handled) return;
      handled = true;
      if (tripId) {
        void loadEditor(tripId, () => navigate(dashboardUrl));
      } else if (isNew) {
        openEditor(null);
      } else {
        navigate(dashboardUrl);
      }
    },
    anonymous: () => {
      clearAuthUnavailableState();
      if (handled) return;
      handled = true;
      if (!tripId && !isNew) {
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

function openEditor(trip: Parameters<typeof mountEditor>[0]['trip']): void {
  document.getElementById('te-workspace')?.removeAttribute('hidden');
  mountEditor({ trip });
  document.body.classList.add('ready');
}

async function loadEditor(tripId: string, backToDashboard: () => void): Promise<void> {
  try {
    const trip = await getTrip(tripId);
    openEditor(trip);
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
