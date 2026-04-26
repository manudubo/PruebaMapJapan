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
import { initKeycloak, getUserInfo, login } from '@/auth/keycloak';
import { getMyTrips, getMe } from '@/api/client';
import { extendSearchIndexWithApiTrip } from '@/modules/search';
import type { ApiTrip, ApiUser } from '@/types';

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

function renderTripCard(trip: ApiTrip): string {
  const destCount = trip.destinations?.length ?? 0;
  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const href = `trip.html?tripId=${trip.id}`;
  const badgeHtml = trip.is_public
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

function renderGrid(trips: ApiTrip[]): void {
  const grid = document.getElementById('trips-grid');
  if (!grid) return;

  if (trips.length === 0) {
    grid.innerHTML = `
      <div class="trips-empty">
        <p>Todavía no tenés ningún viaje guardado.</p>
        <p>¡Creá tu primer itinerario con el botón de arriba!</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = trips.map((t) => renderTripCard(t)).join('');
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
      // Extend search index with the user's trips
      trips.forEach((t) => extendSearchIndexWithApiTrip(t));
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
