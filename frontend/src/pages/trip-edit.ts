import '@/styles/main.css';
import '@/components/Navbar';

import { initTheme } from '@/modules/theme';
import { initKeycloak, isAuthenticated } from '@/auth/keycloak';
import { getTrip } from '@/api/client';
import { initMetadataSection } from './trip-edit/metadata';
import { initDestinationsSection } from './trip-edit/destinations';

async function init(): Promise<void> {
  initTheme();

  const params = new URLSearchParams(window.location.search);
  const tripId = params.get('tripId');

  let authenticated = false;
  try {
    authenticated = await initKeycloak();
  } catch { /* continue */ }

  if (!authenticated || !isAuthenticated()) {
    window.location.href = 'dashboard.html';
    return;
  }

  if (!tripId) {
    window.location.href = 'dashboard.html';
    return;
  }

  try {
    const trip = await getTrip(tripId);
    initMetadataSection(trip);
    initDestinationsSection(trip, tripId);
    const destSection = document.getElementById('destinations-section');
    destSection?.removeAttribute('hidden');
    document.body.classList.add('ready');
  } catch {
    window.location.href = 'dashboard.html';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
