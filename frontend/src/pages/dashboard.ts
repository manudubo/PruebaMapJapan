/**
 * Dashboard Page
 *
 * Loads and renders the authenticated user's trips.
 * Unauthenticated users see a demo mode with the Japan 2026 trip.
 */

import '@/styles/main.css';
import '@/components/Navbar';
import '@/components/SearchBar';

import { initTheme } from '@/modules/theme';
import { initKeycloak, isAuthenticated, getUserInfo, login, logout } from '@/auth/keycloak';
import { getMyTrips, getMe } from '@/api/client';
import type { ApiTrip, ApiUser } from '@/types';

// ---------------------------------------------------------------------------
// Demo trip (Japan 2026 – shown to unauthenticated visitors)
// ---------------------------------------------------------------------------

const DEMO_TRIP: ApiTrip = {
  id: 'demo',
  user_id: 'demo',
  name: 'Japón 2026',
  description: '30 días recorriendo 8 ciudades del País del Sol Naciente.',
  start_date: '2026-02-22',
  end_date: '2026-03-23',
  cover_image_url: null,
  is_public: true,
  destinations: [
    {
      id: 'demo-tokyo',
      trip_id: 'demo',
      city_name: 'Tokyo',
      country: 'Japan',
      start_date: '2026-02-22',
      end_date: '2026-03-01',
      lat: 35.6762,
      lng: 139.705,
      zoom_level: 12,
      order_index: 0,
      days: [],
    },
    {
      id: 'demo-nagoya',
      trip_id: 'demo',
      city_name: 'Nagoya',
      country: 'Japan',
      start_date: '2026-03-02',
      end_date: '2026-03-03',
      lat: 35.17,
      lng: 136.9,
      zoom_level: 11,
      order_index: 1,
      days: [],
    },
    {
      id: 'demo-takayama',
      trip_id: 'demo',
      city_name: 'Takayama',
      country: 'Japan',
      start_date: '2026-03-04',
      end_date: '2026-03-07',
      lat: 36.14,
      lng: 137.25,
      zoom_level: 10,
      order_index: 2,
      days: [],
    },
    {
      id: 'demo-kyoto',
      trip_id: 'demo',
      city_name: 'Kyoto',
      country: 'Japan',
      start_date: '2026-03-08',
      end_date: '2026-03-13',
      lat: 35.0,
      lng: 135.76,
      zoom_level: 12,
      order_index: 3,
      days: [],
    },
    {
      id: 'demo-osaka',
      trip_id: 'demo',
      city_name: 'Osaka',
      country: 'Japan',
      start_date: '2026-03-14',
      end_date: '2026-03-17',
      lat: 34.69,
      lng: 135.5,
      zoom_level: 12,
      order_index: 4,
      days: [],
    },
    {
      id: 'demo-naoshima',
      trip_id: 'demo',
      city_name: 'Naoshima',
      country: 'Japan',
      start_date: '2026-03-18',
      end_date: '2026-03-19',
      lat: 34.46,
      lng: 133.995,
      zoom_level: 13,
      order_index: 5,
      days: [],
    },
    {
      id: 'demo-hakone',
      trip_id: 'demo',
      city_name: 'Hakone',
      country: 'Japan',
      start_date: '2026-03-20',
      end_date: '2026-03-21',
      lat: 35.233,
      lng: 139.107,
      zoom_level: 12,
      order_index: 6,
      days: [],
    },
    {
      id: 'demo-tokyo2',
      trip_id: 'demo',
      city_name: 'Tokyo (regreso)',
      country: 'Japan',
      start_date: '2026-03-22',
      end_date: '2026-03-23',
      lat: 35.6762,
      lng: 139.705,
      zoom_level: 12,
      order_index: 7,
      days: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

function renderTripCard(trip: ApiTrip, isDemo = false): string {
  const destCount = trip.destinations.length;
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const href = isDemo ? 'index.html' : `trip.html?tripId=${trip.id}`;
  const badgeHtml = isDemo
    ? '<span class="trip-card-badge">Demo</span>'
    : trip.is_public
    ? '<span class="trip-card-badge trip-card-badge--public">Público</span>'
    : '';

  const coverStyle = trip.cover_image_url
    ? `background-image:url('${trip.cover_image_url}');background-size:cover;background-position:center;`
    : 'background: linear-gradient(135deg, var(--accent-subtle,#e8f0fe) 0%, var(--border-color,#e5e5ea) 100%);';

  return `
    <a href="${href}" class="trip-card" aria-label="Ver viaje: ${trip.name}">
      <div class="trip-card-cover" style="${coverStyle}">
        ${badgeHtml}
      </div>
      <div class="trip-card-body">
        <h3 class="trip-card-title">${trip.name}</h3>
        ${trip.description ? `<p class="trip-card-desc">${trip.description}</p>` : ''}
        <div class="trip-card-meta">
          ${dateRange ? `<span class="trip-card-dates">${dateRange}</span>` : ''}
          <span class="trip-card-dests">${destCount} destino${destCount !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </a>
  `;
}

function renderGrid(trips: ApiTrip[], isDemo = false): void {
  const grid = document.getElementById('trips-grid');
  if (!grid) return;

  if (trips.length === 0 && !isDemo) {
    grid.innerHTML = `
      <div class="trips-empty">
        <p>Todavía no tenés ningún viaje guardado.</p>
        <p>¡Creá tu primer itinerario con el botón de arriba!</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = trips.map((t, i) => renderTripCard(t, isDemo && i === 0)).join('');
}

function renderUserGreeting(user: ApiUser | null): void {
  const greeting = document.getElementById('dashboard-greeting');
  if (!greeting) return;
  const name = user?.name ?? getUserInfo()?.name ?? null;
  greeting.textContent = name ? `Hola, ${name.split(' ')[0]}` : 'Mis viajes';
}

// ---------------------------------------------------------------------------
// Create-trip form
// ---------------------------------------------------------------------------

function openCreateForm(): void {
  const overlay = document.getElementById('create-trip-overlay');
  overlay?.removeAttribute('hidden');
}

function closeCreateForm(): void {
  const overlay = document.getElementById('create-trip-overlay');
  overlay?.setAttribute('hidden', '');
}

async function handleCreateTrip(e: Event): Promise<void> {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form));

  const { createTrip } = await import('@/api/client');

  const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const newTrip = await createTrip({
      name: data['name'] as string,
      description: (data['description'] as string) || null,
      start_date: (data['start_date'] as string) || null,
      end_date: (data['end_date'] as string) || null,
      is_public: false,
    });
    window.location.href = `trip.html?tripId=${newTrip.id}`;
  } catch (err) {
    const msg = document.getElementById('create-trip-error');
    if (msg) msg.textContent = (err as Error).message;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Auth buttons
// ---------------------------------------------------------------------------

function setupAuthButtons(authenticated: boolean): void {
  const loginBtn = document.getElementById('auth-login-btn');
  const logoutBtn = document.getElementById('auth-logout-btn');

  if (loginBtn) {
    if (authenticated) {
      loginBtn.setAttribute('hidden', '');
    } else {
      loginBtn.removeAttribute('hidden');
      loginBtn.addEventListener('click', () => login());
    }
  }

  if (logoutBtn) {
    if (authenticated) {
      logoutBtn.removeAttribute('hidden');
      logoutBtn.addEventListener('click', () => logout(window.location.origin + '/index.html'));
    } else {
      logoutBtn.setAttribute('hidden', '');
    }
  }

  // Inline login prompt inside the grid area
  const loginPrompt = document.getElementById('dashboard-login-prompt');
  const tripsGrid = document.getElementById('trips-grid');
  const promptLoginBtn = document.getElementById('auth-login-prompt-btn');

  if (!authenticated && loginPrompt && tripsGrid) {
    loginPrompt.removeAttribute('hidden');
    tripsGrid.setAttribute('hidden', '');
    if (promptLoginBtn) {
      promptLoginBtn.addEventListener('click', () => login(window.location.href));
    }
  }
}

// ---------------------------------------------------------------------------
// Main init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initTheme();

  // Attempt silent SSO — never redirect the user
  let authenticated = false;
  try {
    authenticated = await initKeycloak();
  } catch {
    // Keycloak may not be running in dev/demo mode — continue as guest
  }

  setupAuthButtons(authenticated);

  const newTripBtn = document.getElementById('new-trip-btn');
  if (newTripBtn) {
    if (authenticated) {
      newTripBtn.removeAttribute('hidden');
      newTripBtn.addEventListener('click', openCreateForm);
    } else {
      newTripBtn.setAttribute('hidden', '');
    }
  }

  // Create-trip form listeners
  const createForm = document.getElementById('create-trip-form');
  createForm?.addEventListener('submit', handleCreateTrip);
  document.getElementById('create-trip-cancel')?.addEventListener('click', closeCreateForm);
  document.getElementById('create-trip-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCreateForm();
  });

  if (authenticated) {
    // Load real user profile and trips
    let user: ApiUser | null = null;
    try {
      user = await getMe();
    } catch {
      // Non-critical — greeting will fall back to token data
    }
    renderUserGreeting(user);

    try {
      const trips = await getMyTrips();
      renderGrid(trips);
    } catch (err) {
      const grid = document.getElementById('trips-grid');
      if (grid)
        grid.innerHTML = `<p class="trips-error">No se pudieron cargar los viajes: ${(err as Error).message}</p>`;
    }
  } else {
    // Guest mode — show login prompt (grid is hidden by setupAuthButtons)
    renderUserGreeting(null);
  }

  document.body.classList.add('ready');
}

// Bootstrap when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
