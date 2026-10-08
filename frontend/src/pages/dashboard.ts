/**
 * Dashboard Page
 *
 * Loads and renders the authenticated user's trips.
 * Unauthenticated users see a demo mode with the Japan 2026 trip.
 */

import '@/styles/main.css';
import '@/styles/trip-view.css';
import '@/components/Navbar';
import '@/components/SearchBar';

import { initTheme } from '@/modules/theme';
import { getUserInfo, login, getToken, keycloak, loginRedirectUri } from '@/auth/keycloak';
import {
  watchAuth,
  showAuthPending,
  hideAuthPending,
  showAuthUnavailableState,
  clearAuthUnavailableState,
  showSignUpNotice,
} from '@/auth/authStatusUI';
import { registrationEnabled, takeSignUpOutcome, wireSignUpButton } from '@/auth/registration';
import { checkPasskeyCampaign, createPrefsStore, runNewUserOnboarding } from '@/modules/passkeyCampaign';
import { showEmailVerification } from '@/auth/verifyEmail';
import { getMyTrips, getMe, updateMe, apiUrl, ApiError } from '@/api/client';
import { extendSearchIndexWithApiTrip } from '@/modules/search';
import type { ApiTrip, ApiUser } from '@/types';
import { showToast, installGlobalErrorHandler } from '@/modules/toast';
import {
  renderEmptyState,
  renderLoadError,
  renderSkeletonCards,
  renderTripGroups,
  showSlowNotice,
} from '@/pages/tripCards';

// ---------------------------------------------------------------------------
// Trips list: loading, slow, empty, error, loaded
// ---------------------------------------------------------------------------

/** After this long without an answer the list says so and offers "Try again" (the request keeps going). */
export const SLOW_TRIPS_MS = 3000;

let tripsSeq = 0;
let tripsShown = false;
let loadingOpen = false;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function tripsGrid(): HTMLElement | null {
  return document.getElementById('trips-grid');
}

/**
 * Show the skeleton and arm the "taking longer" timer. Idempotent while a loading phase is
 * open (profile call + trips call share one 3s budget); `force` starts a fresh phase (Try again).
 */
function beginLoading(force = false): number {
  const grid = tripsGrid();
  if (!grid) return tripsSeq;
  if (loadingOpen && !force) return tripsSeq;
  loadingOpen = true;
  tripsShown = false;
  const seq = ++tripsSeq;
  clearTimeout(slowTimer);
  grid.removeAttribute('hidden');
  renderSkeletonCards(grid);
  slowTimer = setTimeout(() => {
    if (!tripsShown && seq === tripsSeq) showSlowNotice(grid, () => { void loadTrips(true); });
  }, SLOW_TRIPS_MS);
  return seq;
}

function endLoading(): void {
  loadingOpen = false;
  clearTimeout(slowTimer);
}

function showTripsLoaded(trips: ApiTrip[]): void {
  const grid = tripsGrid();
  if (!grid) return;
  endLoading();
  tripsShown = true;
  grid.removeAttribute('aria-busy');
  if (trips.length === 0) renderEmptyState(grid, openCreateForm);
  else renderTripGroups(grid, trips);
}

/**
 * Fetch and show the user's trips. Never leaves the user on a blank or endless loading list:
 * skeleton cards at once, a "taking longer" notice with Try again after SLOW_TRIPS_MS, and a
 * persistent error with Try again if the request fails. A late answer still replaces the notice.
 */
export async function loadTrips(retry = false): Promise<void> {
  const grid = tripsGrid();
  if (!grid) return;
  const seq = beginLoading(retry);
  try {
    const trips = await getMyTrips();
    if (tripsShown) return; // another attempt already answered
    showTripsLoaded(trips);
    // Extend search index with the user's trips
    trips.forEach((t) => extendSearchIndexWithApiTrip(t));
  } catch {
    if (tripsShown || seq !== tripsSeq) return; // answered meanwhile, or superseded by a retry
    endLoading();
    renderLoadError(grid, () => { void loadTrips(true); });
  }
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

/** True from the first submit until it fails (on success we stay locked while navigating). */
let creatingTrip = false;

// Exported for dashboard-create-trip.test.ts.
export async function handleCreateTrip(e: Event): Promise<void> {
  e.preventDefault();
  // Guard synchronously, before any await: a double click / Enter repeat fires two submit
  // events in the same tick, and the old code awaited a dynamic import before disabling the
  // button, so both submits reached the API and created two trips.
  if (creatingTrip) return;
  creatingTrip = true;

  const form = e.target as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form));
  const submitBtn = form.querySelector<HTMLButtonElement>('[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  form.setAttribute('aria-busy', 'true');

  try {
    const { createTrip } = await import('@/api/client');
    const newTrip = await createTrip({
      name: data['name'] as string,
      description: (data['description'] as string) || null,
      start_date: (data['start_date'] as string) || null,
      end_date: (data['end_date'] as string) || null,
      is_public: false,
    });
    window.location.href = `trip.html?tripId=${newTrip.id}`;
  } catch {
    showToast('Something went wrong. Please try again.', 'error');
    creatingTrip = false;
    if (submitBtn) submitBtn.disabled = false;
    form.removeAttribute('aria-busy');
  }
}

// ---------------------------------------------------------------------------
// Auth buttons
// ---------------------------------------------------------------------------

/** Signed out (Keycloak answered): show the "please sign in" prompt. */
function showLoginPrompt(): void {
  const loginPrompt = document.getElementById('dashboard-login-prompt');
  const tripsGrid = document.getElementById('trips-grid');
  const newTripBtn = document.getElementById('new-trip-btn');
  const promptLoginBtn = document.getElementById('auth-login-prompt-btn');

  loginPrompt?.removeAttribute('hidden');
  if (tripsGrid) {
    tripsGrid.innerHTML = '';
    tripsGrid.setAttribute('hidden', '');
  }
  newTripBtn?.setAttribute('hidden', '');
  if (promptLoginBtn && !promptLoginBtn.dataset['wired']) {
    promptLoginBtn.dataset['wired'] = '1';
    promptLoginBtn.addEventListener('click', () => login(window.location.href));
  }
  const promptSignupBtn = document.getElementById('auth-signup-prompt-btn');
  if (registrationEnabled()) {
    wireSignUpButton(promptSignupBtn, () => showSignUpNotice('unavailable'));
  } else {
    promptSignupBtn?.setAttribute('hidden', '');
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
    const res = await fetch(apiUrl('/auth/otp-request'), {
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
    const res = await fetch(apiUrl('/auth/otp-verify'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if (res.ok) {
      closeOtpModal();
      // D-21: force password reset only for non-WebAuthn devices
      if (!capable) {
        await keycloak.login({ action: 'UPDATE_PASSWORD', redirectUri: loginRedirectUri() });
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

/**
 * Passkey/password prompts after sign-in. A just-registered account (onboarding.is_new) gets the
 * onboarding dialog; everyone else keeps the old behavior (passkey nudge on capable devices,
 * OTP banner on the rest).
 */
function startCampaigns(userKey: string, user: ApiUser | null): void {
  if (user?.onboarding?.is_new) {
    const store = createPrefsStore(userKey, user.preferences, (preferences) => updateMe({ preferences }));
    void runNewUserOnboarding({ isNew: true, userKey, store });
  } else if (webauthnCapable) {
    checkPasskeyCampaign(userKey);
  } else {
    buildOtpBanner();
  }
}

/** Signed in: load the user's profile and trips (runs once, even if auth resolves late). */
async function loadAuthenticated(): Promise<void> {
  document.getElementById('dashboard-login-prompt')?.setAttribute('hidden', '');
  const newTripBtn = document.getElementById('new-trip-btn');
  if (newTripBtn) {
    newTripBtn.removeAttribute('hidden');
    newTripBtn.addEventListener('click', openCreateForm);
  }

  webauthnCapable = typeof PublicKeyCredential !== 'undefined';
  const info = getUserInfo();
  // Load real user profile and trips
  beginLoading();

  let user: ApiUser | null = null;
  try {
    user = await getMe();
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && err.code === 'email_not_verified') {
      // The gate that watchAuth installed is already showing the verification screen
      // (src/auth/verifyEmail.ts) and reloads the page once the address is verified.
      return;
    }
    // Other failures are non-critical — greeting will fall back to token data
  }
  if (user && user.email_verified === false && info) {
    await showEmailVerification({ email: user.email || info.email || null, userKey: info.id });
    user = { ...user, email_verified: true };
    beginLoading(true); // the 3s "slow" budget restarts after the user finished verifying
  }

  // The first call is handled explicitly above; any later 403 email_not_verified is handled by
  // the gate that watchAuth installs (src/auth/authStatusUI.ts).
  if (info) startCampaigns(info.id, user);
  renderUserGreeting(user);

  await loadTrips();
}

function init(): void {
  initTheme();
  installGlobalErrorHandler();

  // Create-trip form listeners
  const createForm = document.getElementById('create-trip-form');
  createForm?.addEventListener('submit', handleCreateTrip);
  document.getElementById('create-trip-cancel')?.addEventListener('click', closeCreateForm);
  document.getElementById('create-trip-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeCreateForm();
  });

  // Silent SSO only — never redirect. Bounded: 'unavailable' after a few seconds at most.
  showAuthPending();
  let loaded = false;
  watchAuth({
    authenticated: () => {
      hideAuthPending();
      clearAuthUnavailableState();
      if (loaded) return;
      loaded = true;
      void loadAuthenticated();
    },
    anonymous: () => {
      hideAuthPending();
      clearAuthUnavailableState();
      showLoginPrompt();
      renderUserGreeting(null);
      showSignUpNotice(takeSignUpOutcome(false));
    },
    // Distinct from "please sign in": we don't know yet whether the user is signed in.
    unavailable: () => {
      showAuthUnavailableState();
    },
  });

  document.body.classList.add('ready');
}

// Bootstrap when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
