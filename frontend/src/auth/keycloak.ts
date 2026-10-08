import Keycloak from 'keycloak-js';

// ---------------------------------------------------------------------------
// Configuration — injected via Vite env vars at build time
// ---------------------------------------------------------------------------

/** Base URL incl. a relative path in single-host mode (https://host/auth); trailing slashes dropped. */
export function keycloakBaseUrl(raw: string | undefined): string {
  return (raw ?? 'http://localhost:8080').trim().replace(/\/+$/, '');
}

export const KEYCLOAK_URL = keycloakBaseUrl(import.meta.env['VITE_KEYCLOAK_URL'] as string | undefined);
const KEYCLOAK_REALM = import.meta.env['VITE_KEYCLOAK_REALM'] as string | undefined ?? 'japan-trip';
const KEYCLOAK_CLIENT_ID = import.meta.env['VITE_KEYCLOAK_CLIENT_ID'] as string | undefined ?? 'japan-trip-frontend';

// ---------------------------------------------------------------------------
// Keycloak JS adapter instance
//
// keycloak-js refuses a second init() on the same instance, so an explicit
// retry runs on a fresh instance. `keycloak` is an ES live binding: importers
// always see the instance whose answer was adopted.
// ---------------------------------------------------------------------------

function createKeycloak(): Keycloak {
  return new Keycloak({
    url: KEYCLOAK_URL,
    realm: KEYCLOAK_REALM,
    clientId: KEYCLOAK_CLIENT_ID,
  });
}

let keycloak = createKeycloak();

// ---------------------------------------------------------------------------
// Auth status
//
// The UI must never wait on Keycloak unboundedly: keycloak-js waits 10 s for
// its 3rd-party-cookie iframe and has no timeout at all on the silent
// check-sso iframe. Callers get a bounded answer after AUTH_INIT_TIMEOUT_MS
// ('unavailable'); if the real attempt finishes later, the status is updated
// and listeners fire (late success), without a second init(). The first
// attempt to answer wins, so a slow original attempt still counts after Retry.
// ---------------------------------------------------------------------------

/** How long pages wait for Keycloak before showing the logged-out state. */
export const AUTH_INIT_TIMEOUT_MS = 4000;

export type AuthStatus = 'pending' | 'authenticated' | 'anonymous' | 'unavailable';
export type AuthUnavailableReason = 'timeout' | 'error' | 'offline';

export class AuthUnavailableError extends Error {
  readonly reason: AuthUnavailableReason;
  constructor(reason: AuthUnavailableReason, cause?: unknown) {
    super(`Sign-in service unavailable (${reason})`);
    this.name = 'AuthUnavailableError';
    this.reason = reason;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

type AuthListener = (status: AuthStatus) => void;

let status: AuthStatus = 'pending';
let unavailableReason: AuthUnavailableReason | null = null;
const listeners = new Set<AuthListener>();

/** keycloak.init() of the latest instance (null: never started, e.g. offline). */
let attempt: Promise<boolean> | null = null;
/** What callers await: the attempt raced against the timeout. */
let bounded: Promise<boolean> | null = null;
let onlineRetryArmed = false;

function setStatus(next: AuthStatus, reason: AuthUnavailableReason | null = null): void {
  if (status === next && unavailableReason === reason) return;
  status = next;
  unavailableReason = reason;
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch (err) {
      console.error('[auth] status listener failed', err);
    }
  }
}

export function getAuthStatus(): AuthStatus {
  return status;
}

export function getAuthUnavailableReason(): AuthUnavailableReason | null {
  return unavailableReason;
}

/** Subscribe to status changes (not called with the current value). Returns an unsubscribe. */
export function onAuthStatusChange(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The app's base URL with a trailing slash (Vite BASE_URL: /PruebaMapJapan/ on Pages, / in tests). */
function appBase(): string {
  const base = ((import.meta.env.BASE_URL as string | undefined) ?? '/').replace(/\/?$/, '/');
  return window.location.origin + base;
}

/** Absolute URL of an app page, e.g. appPageUrl('dashboard.html'). */
export function appPageUrl(page: string): string {
  return appBase() + page;
}

function silentCheckSsoRedirectUri(): string {
  return appPageUrl('silent-check-sso.html');
}

// ---------------------------------------------------------------------------
// Login redirect URIs
//
// Keycloak accepts only the exact redirect URIs registered for the client
// (terraform/keycloak/main.tf `redirect_pages`: no query strings, no
// wildcards, which would let any page under the origin receive codes). Sending
// window.location.href from trip-edit.html?tripId=12 got 400 "Invalid
// redirect_uri". So every login goes to a registered page, and the real
// target (same app, path + query + hash) waits in sessionStorage until the
// landing page has processed Keycloak's callback, then the user is sent back.
// ---------------------------------------------------------------------------

/** Registered redirect pages (silent-check-sso.html is only for the silent iframe). */
export const LOGIN_REDIRECT_PAGES = ['dashboard.html', 'profile.html', 'index.html'] as const;
const DEFAULT_LANDING_PAGE = 'dashboard.html';
export const RETURN_TO_KEY = 'travelmap.auth.returnTo';
/** A remembered target older than this belongs to an abandoned login. */
export const RETURN_TO_TTL_MS = 15 * 60 * 1000;

let navigateTo: (url: string) => void = (url) => window.location.replace(url);

/** Test-only: observe the post-login navigation (jsdom cannot navigate). */
export function __setNavigateForTests(fn: (url: string) => void): void {
  navigateTo = fn;
}

function storeReturnTo(path: string | null): void {
  try {
    if (path === null) window.sessionStorage.removeItem(RETURN_TO_KEY);
    else window.sessionStorage.setItem(RETURN_TO_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage blocked: the login still works, the user just lands on the registered page.
  }
}

/** A same-app path (+query+hash) for `raw`, or null for anything that could leave the app. */
function sameAppPath(raw: string): string | null {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  const base = new URL(appBase());
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
  return url.pathname + url.search + url.hash;
}

/** The remembered target (once: the entry is removed), or null if absent, stale or invalid. */
function takeReturnTo(): string | null {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(RETURN_TO_KEY);
  } catch {
    return null;
  }
  storeReturnTo(null);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof entry.path !== 'string' || typeof entry.at !== 'number') return null;
    if (Date.now() - entry.at > RETURN_TO_TTL_MS || entry.at > Date.now() + 60_000) return null;
    return sameAppPath(entry.path);
  } catch {
    return null;
  }
}

/**
 * The redirect URI to send to Keycloak for a login that should end on
 * `target` (default: this page). A registered page without query or hash is
 * sent as is; anything else lands on a registered page (the same page when it
 * is registered, else the dashboard) and `target` is remembered. Targets
 * outside the app are never remembered.
 */
export function loginRedirectUri(target: string = window.location.href): string {
  let url: URL | null = null;
  try {
    url = new URL(target, window.location.href);
  } catch {
    url = null;
  }
  const path = url && url.origin === window.location.origin ? sameAppPath(url.pathname + url.search + url.hash) : null;
  if (!url || path === null) {
    storeReturnTo(null);
    return appPageUrl(DEFAULT_LANDING_PAGE);
  }
  const rest = url.pathname.slice(new URL(appBase()).pathname.length);
  const page = rest === '' ? 'index.html' : rest;
  const registered = (LOGIN_REDIRECT_PAGES as readonly string[]).includes(page);
  if (registered && !url.search && !url.hash) {
    storeReturnTo(null);
    return appPageUrl(page);
  }
  storeReturnTo(path);
  return appPageUrl(registered ? page : DEFAULT_LANDING_PAGE);
}

/** keycloak-js puts the authorization response in the fragment (responseMode 'fragment'). */
function isLoginCallback(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.has('state') && (params.has('code') || params.has('error'));
}

/** After the callback was processed: send the user back to where the login started. */
function finishLoginRedirect(authenticated: boolean): void {
  const target = takeReturnTo();
  if (!authenticated || target === null) return;
  const here = window.location.pathname + window.location.search;
  if (target === here || target.split('#')[0] === here) return;
  navigateTo(window.location.origin + target);
}

function startAttempt(): Promise<boolean> {
  const kc = keycloak;
  // Read before init(): keycloak-js consumes the callback fragment.
  const callback = typeof window !== 'undefined' && isLoginCallback(window.location.hash);

  kc.onTokenExpired = () => {
    if (import.meta.env.DEV) console.debug('[auth] token expired, refreshing');
    refreshToken().then((ok) => {
      if (!ok) console.warn('[auth] token refresh failed — session may have expired');
    });
  };

  const p = kc.init({
    onLoad: 'check-sso',
    silentCheckSsoRedirectUri: silentCheckSsoRedirectUri(),
    pkceMethod: 'S256',
    responseMode: 'fragment',
    checkLoginIframe: false,
  }).then(
    (authenticated) => {
      // Another attempt already answered: keep that one.
      if (status === 'authenticated' || status === 'anonymous') return authenticated;
      keycloak = kc; // adopt (may be an older, slow attempt that finished after a Retry)
      if (import.meta.env.DEV) {
        const tokenState = !authenticated
          ? 'unauthenticated'
          : kc.token
            ? `token=present (sub=${kc.tokenParsed?.['sub']?.slice(0, 8)})`
            : 'WARN: authenticated=true but token=null — broken auth state';
        console.debug(`[auth] init: ${tokenState}`);
      }
      if (callback) finishLoginRedirect(authenticated);
      // A late answer replaces an earlier timeout for every later caller.
      bounded = Promise.resolve(authenticated);
      setStatus(authenticated ? 'authenticated' : 'anonymous');
      return authenticated;
    },
    (err: unknown) => {
      // Only the latest attempt's failure matters; an older one failing after a Retry is noise.
      if (kc === keycloak && status !== 'authenticated' && status !== 'anonymous') {
        setStatus('unavailable', 'error');
      }
      throw err;
    },
  );
  p.catch(() => { /* surfaced through bounded(); avoid unhandled rejections */ });
  attempt = p;
  return p;
}

function withTimeout(p: Promise<boolean>): Promise<boolean> {
  const result = new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (status === 'pending') setStatus('unavailable', 'timeout');
      reject(new AuthUnavailableError('timeout'));
    }, AUTH_INIT_TIMEOUT_MS);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof AuthUnavailableError ? e : new AuthUnavailableError('error', e));
      },
    );
  });
  result.catch(() => { /* callers handle it; keep a stored promise from being "unhandled" */ });
  return result;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function armOnlineRetry(): void {
  if (onlineRetryArmed || typeof window === 'undefined') return;
  onlineRetryArmed = true;
  window.addEventListener('online', () => {
    onlineRetryArmed = false;
    if (status === 'unavailable') retryAuth().catch(() => { /* status carries it */ });
  }, { once: true });
}

function begin(): Promise<boolean> {
  setStatus('pending');
  if (isOffline()) {
    setStatus('unavailable', 'offline');
    armOnlineRetry();
    bounded = Promise.reject(new AuthUnavailableError('offline'));
    bounded.catch(() => { /* see withTimeout */ });
    return bounded;
  }
  bounded = withTimeout(startAttempt());
  return bounded;
}

/**
 * Initialize the Keycloak adapter (silent check-sso). Safe to call many times:
 * every caller shares one attempt.
 *
 * Resolves true/false (signed in or not) or rejects with AuthUnavailableError
 * after at most AUTH_INIT_TIMEOUT_MS, so no page can hang on Keycloak. Tokens
 * live only in keycloak-js memory (never localStorage/sessionStorage); after a
 * reload the session is restored from the Keycloak SSO cookie.
 */
export function initKeycloak(): Promise<boolean> {
  return bounded ?? begin();
}

/**
 * Re-attempt after 'unavailable' on a fresh keycloak-js instance (an instance
 * can only init once, and a hung one may never settle: keycloak-js has no
 * timeout on the silent-SSO iframe). Rapid calls share one attempt; a previous
 * attempt that answers first still wins (see startAttempt).
 */
export function retryAuth(): Promise<boolean> {
  if (status === 'pending' && bounded) return bounded;
  if (status === 'authenticated' || status === 'anonymous') return bounded ?? initKeycloak();
  if (attempt) keycloak = createKeycloak();
  attempt = null;
  return begin();
}

/** Test-only: forget all state and start with a fresh instance. */
export function __resetAuthForTests(): void {
  keycloak = createKeycloak();
  status = 'pending';
  unavailableReason = null;
  listeners.clear();
  attempt = null;
  bounded = null;
  onlineRetryArmed = false;
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/**
 * Redirect to Keycloak login page with PKCE + passkey flow. After login the
 * user comes back to `target` (default: this page, query string included);
 * see loginRedirectUri.
 */
export async function login(target?: string): Promise<void> {
  // keycloak-js wires its redirect adapter synchronously at the start of init();
  // make sure that happened even if init was skipped (offline) so login works.
  if (!attempt) bounded = withTimeout(startAttempt());
  await keycloak.login({
    redirectUri: loginRedirectUri(target),
    scope: 'openid profile email',
  });
}

/**
 * Redirect to Keycloak logout endpoint and clear the local session. The
 * default target is a registered post-logout URI (the bare origin is not).
 */
export async function logout(redirectUri?: string): Promise<void> {
  await keycloak.logout({
    redirectUri: redirectUri ?? appPageUrl('index.html'),
  });
}

/**
 * Returns the current access token, refreshing it first if it expires within
 * the next 30 seconds. Throws if the user is not authenticated.
 */
export async function getToken(): Promise<string> {
  if (!keycloak.authenticated) {
    throw new Error('User is not authenticated');
  }

  if (import.meta.env.DEV) {
    console.debug(`[auth] getToken: hasToken=${!!keycloak.token}, hasRefresh=${!!keycloak.refreshToken}, expiredIn30s=${keycloak.isTokenExpired(30)}`);
  }

  // Only attempt a refresh when the token is actually near expiry.
  // updateToken(30) throws "Not authenticated" if there is no refresh token
  // (e.g. after a silent-check-sso exchange that KC issues without one).
  // Skipping it when the access token is still valid avoids that throw.
  if (keycloak.isTokenExpired(30)) {
    try {
      await keycloak.updateToken(30);
    } catch {
      throw new Error('Failed to refresh access token — please log in again');
    }
  }

  if (!keycloak.token) {
    throw new Error('No access token available');
  }

  return keycloak.token;
}

/**
 * Silently refresh the access token. Returns true on success, false on failure.
 */
export async function refreshToken(): Promise<boolean> {
  try {
    const refreshed = await keycloak.updateToken(30);
    return refreshed;
  } catch {
    return false;
  }
}

/**
 * Returns true if the user is currently authenticated with a valid token.
 */
export function isAuthenticated(): boolean {
  return keycloak.authenticated === true && !!keycloak.token;
}

/**
 * Returns the decoded token payload, or null if not authenticated.
 */
export function getTokenParsed(): Keycloak.KeycloakTokenParsed | undefined {
  return keycloak.tokenParsed;
}

/**
 * Returns a standard user info object from the decoded token, or null if not
 * authenticated.
 *
 * Source of truth — getUserInfo() vs getMe() (api/client.ts):
 * - getUserInfo() is synchronous and local (JWT claims as issued by Keycloak
 *   at the last token refresh). Use it for identity and instant UI that must
 *   not wait on the network: the Keycloak subject (`id`, e.g. the passkey
 *   campaign key), the navbar name, and first paint of greetings/profile.
 * - getMe() is the backend's app-DB user record (numeric id, avatar_url,
 *   preferences, created_at). Use it for anything the app stores or edits, and
 *   prefer its name/email once loaded; the backend refreshes email/name from
 *   the token on each authenticated request, so the two converge.
 * Pattern: render from getUserInfo() first, then enrich from getMe()
 * (see dashboard.ts renderUserGreeting and profile.ts).
 */
export function getUserInfo(): {
  id: string;
  email: string;
  name: string;
  preferredUsername: string;
} | null {
  const parsed = keycloak.tokenParsed;
  if (!parsed || !keycloak.authenticated) return null;

  return {
    id: (parsed['sub'] as string) ?? '',
    email: (parsed['email'] as string) ?? '',
    name: (parsed['name'] as string) ?? (parsed['preferred_username'] as string) ?? '',
    preferredUsername: (parsed['preferred_username'] as string) ?? '',
  };
}

// Export the raw keycloak instance for advanced use cases
export { keycloak };
