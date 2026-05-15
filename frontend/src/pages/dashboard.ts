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
import { setText, setStyle } from '@/modules/dom';

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return '';
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

function renderTripCard(trip: ApiTrip): HTMLElement {
  const destCount = trip.destinations?.length ?? 0;
  const dateRange = formatDateRange(trip.start_date, trip.end_date);

  const card = document.createElement('a');
  card.href = `trip.html?tripId=${trip.id}`;
  card.className = 'trip-card';
  card.setAttribute('aria-label', `View trip: ${trip.name}`);

  const cover = document.createElement('div');
  cover.className = 'trip-card-cover';
  if (trip.cover_image_url) {
    setStyle(cover, 'background-image', `url('${trip.cover_image_url}')`);
    setStyle(cover, 'background-size', 'cover');
    setStyle(cover, 'background-position', 'center');
  } else {
    setStyle(cover, 'background', 'linear-gradient(135deg, var(--accent-subtle,#e8f0fe) 0%, var(--border-color,#e5e5ea) 100%)');
  }
  if (trip.is_public) {
    const badge = document.createElement('span');
    badge.className = 'trip-card-badge trip-card-badge--public';
    badge.textContent = 'Public';
    cover.appendChild(badge);
  }
  card.appendChild(cover);

  const body = document.createElement('div');
  body.className = 'trip-card-body';

  const title = document.createElement('h3');
  title.className = 'trip-card-title';
  setText(title, trip.name);
  body.appendChild(title);

  if (trip.description) {
    const desc = document.createElement('p');
    desc.className = 'trip-card-desc';
    setText(desc, trip.description);
    body.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'trip-card-meta';
  if (dateRange) {
    const dates = document.createElement('span');
    dates.className = 'trip-card-dates';
    dates.textContent = dateRange;
    meta.appendChild(dates);
  }
  const dests = document.createElement('span');
  dests.className = 'trip-card-dests';
  dests.textContent = `${destCount} destination${destCount !== 1 ? 's' : ''}`;
  meta.appendChild(dests);
  body.appendChild(meta);
  card.appendChild(body);

  // Edit link (TRIP-01)
  const editRow = document.createElement('div');
  editRow.className = 'trip-card-actions';
  editRow.style.cssText = 'padding: 8px 16px 12px; border-top: 1px solid var(--border-color,rgba(0,0,0,0.08))';
  const editLink = document.createElement('a');
  editLink.href = `trip-edit.html?tripId=${trip.id}`;
  editLink.className = 'btn btn-secondary';
  editLink.style.cssText = 'font-size: 13px; padding: 6px 12px; text-decoration: none;';
  editLink.textContent = 'Edit';
  editRow.appendChild(editLink);
  card.appendChild(editRow);

  return card;
}

function renderGrid(trips: ApiTrip[]): void {
  const grid = document.getElementById('trips-grid');
  if (!grid) return;

  grid.innerHTML = '';

  if (trips.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'trips-empty';
    const p1 = document.createElement('p');
    p1.textContent = "You don't have any trips saved yet.";
    const p2 = document.createElement('p');
    p2.textContent = 'Create your first itinerary with the button above!';
    empty.appendChild(p1);
    empty.appendChild(p2);
    grid.appendChild(empty);
    return;
  }

  trips.forEach((t) => grid.appendChild(renderTripCard(t)));
}

function renderUserGreeting(user: ApiUser | null): void {
  const greeting = document.getElementById('dashboard-greeting');
  if (!greeting) return;
  const name = user?.name ?? getUserInfo()?.name ?? null;
  greeting.textContent = name ? `Hello, ${name.split(' ')[0]}` : 'My Trips';
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
      if (grid) {
        grid.innerHTML = '';
        const errP = document.createElement('p');
        errP.className = 'trips-error';
        setText(errP, `Could not load trips: ${(err as Error).message}`);
        grid.appendChild(errP);
      }
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
