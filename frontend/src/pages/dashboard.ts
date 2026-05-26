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
import { initKeycloak, getUserInfo, login, getToken, keycloak } from '@/auth/keycloak';
import { checkPasskeyCampaign } from '@/modules/passkeyCampaign';
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
  const editLink = document.createElement('a');
  editLink.href = `trip-edit.html?tripId=${trip.id}`;
  editLink.className = 'btn btn-secondary btn-small';
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
  const newTripBtn = document.getElementById('new-trip-btn');
  const promptLoginBtn = document.getElementById('auth-login-prompt-btn');

  if (!authenticated && loginPrompt && tripsGrid) {
    loginPrompt.removeAttribute('hidden');
    tripsGrid.innerHTML = '';
    tripsGrid.setAttribute('hidden', '');
    newTripBtn?.setAttribute('hidden', '');
    if (promptLoginBtn) {
      promptLoginBtn.addEventListener('click', () => login(window.location.href));
    }
  }
}

// ---------------------------------------------------------------------------
// OTP banner + modal (PASS-05, PASS-07)
// ---------------------------------------------------------------------------

let webauthnCapable = false;

function buildOtpModal(): void {
  if (document.getElementById('otp-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'otp-modal-overlay';
  overlay.setAttribute('hidden', '');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const h2 = document.createElement('h2');
  h2.textContent = 'Verify your email';

  const desc = document.createElement('p');
  desc.textContent = 'Check your email for a 6-digit code.';

  const input = document.createElement('input');
  input.className = 'otp-input';
  input.id = 'otp-code-input';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.maxLength = 6;
  input.pattern = '\\d{6}';
  input.autocomplete = 'one-time-code';

  const errP = document.createElement('p');
  errP.id = 'otp-error';
  errP.setAttribute('hidden', '');
  errP.className = 'status-msg status-msg--error';

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const resendBtn = document.createElement('button');
  resendBtn.className = 'btn btn-secondary';
  resendBtn.id = 'otp-resend-btn';
  resendBtn.disabled = true;
  resendBtn.textContent = 'Resend';

  const verifyBtn = document.createElement('button');
  verifyBtn.className = 'btn btn-primary';
  verifyBtn.id = 'otp-verify-btn';
  verifyBtn.textContent = 'Verify';

  actions.appendChild(resendBtn);
  actions.appendChild(verifyBtn);
  modal.appendChild(h2);
  modal.appendChild(desc);
  modal.appendChild(input);
  modal.appendChild(errP);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function openOtpModal(): void {
  document.getElementById('otp-modal-overlay')?.removeAttribute('hidden');
  document.getElementById('otp-verify-btn')?.addEventListener('click', () => {
    void handleVerifyOtp(webauthnCapable);
  }, { once: true });
}

function closeOtpModal(): void {
  document.getElementById('otp-modal-overlay')?.setAttribute('hidden', '');
  const errEl = document.getElementById('otp-error');
  if (errEl) errEl.setAttribute('hidden', '');
}

async function handleSendOtp(): Promise<void> {
  const sendBtn = document.getElementById('otp-send-btn') as HTMLButtonElement | null;
  if (sendBtn) sendBtn.disabled = true;

  try {
    const token = await getToken();
    const res = await fetch('/api/auth/otp-request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as { success: boolean; error?: string; retryAfter?: number };

    if (res.status === 201) {
      openOtpModal();
    } else if (res.status === 429 && body.retryAfter) {
      const resendBtn = document.getElementById('otp-resend-btn') as HTMLButtonElement | null;
      if (resendBtn) {
        resendBtn.textContent = `Resend (${body.retryAfter}s)`;
        resendBtn.disabled = true;
      }
      openOtpModal();
    }
  } catch {
    // Non-critical — user can retry
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Exported so dashboard.test.ts can test the UPDATE_PASSWORD gate independently.
// Production call site in openOtpModal passes the module-level webauthnCapable.
export async function handleVerifyOtp(capable: boolean): Promise<void> {
  const codeInput = document.getElementById('otp-code-input') as HTMLInputElement | null;
  const errEl = document.getElementById('otp-error');
  if (!codeInput) return;

  const code = codeInput.value.trim();
  if (code.length !== 6) {
    if (errEl) { errEl.textContent = 'Enter a 6-digit code'; errEl.removeAttribute('hidden'); }
    return;
  }

  try {
    const token = await getToken();
    const res = await fetch('/api/auth/otp-verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (res.ok) {
      closeOtpModal();
      // D-21: force password reset only for non-WebAuthn devices
      if (!capable) {
        await keycloak.login({ action: 'UPDATE_PASSWORD', redirectUri: window.location.href });
      }
    } else {
      const body = await res.json() as { success: boolean; error?: string };
      if (errEl) {
        const msg = body.error === 'max_attempts'
          ? 'Too many attempts. Request a new code.'
          : body.error === 'otp_not_found'
          ? 'Code expired. Request a new one.'
          : 'Incorrect code. Try again.';
        errEl.textContent = msg;
        errEl.removeAttribute('hidden');
      }
    }
  } catch {
    if (errEl) { errEl.textContent = 'Verification failed. Try again.'; errEl.removeAttribute('hidden'); }
  }
}

function buildOtpBanner(): void {
  buildOtpModal();

  const banner = document.createElement('div');
  banner.className = 'otp-banner';
  banner.id = 'otp-banner';

  const p = document.createElement('p');
  p.textContent = "Your device doesn't support passkeys. Verify your email to set a password.";

  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn btn-primary';
  sendBtn.id = 'otp-send-btn';
  sendBtn.textContent = 'Send code';

  banner.appendChild(p);
  banner.appendChild(sendBtn);

  const main = document.querySelector('main') ?? document.body;
  main.prepend(banner);

  sendBtn.addEventListener('click', () => { void handleSendOtp(); });
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
    webauthnCapable = typeof PublicKeyCredential !== 'undefined';
    const info = getUserInfo();
    if (info) {
      if (webauthnCapable) {
        checkPasskeyCampaign(info.id);
      } else {
        buildOtpBanner();
      }
    }

    // Load real user profile and trips
    const grid = document.getElementById('trips-grid');
    if (grid) {
      grid.removeAttribute('hidden');
      grid.innerHTML = '<div class="trips-empty">Loading trips...</div>';
    }

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
