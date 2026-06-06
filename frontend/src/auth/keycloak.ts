import Keycloak from 'keycloak-js';

// ---------------------------------------------------------------------------
// Configuration — injected via Vite env vars at build time
// ---------------------------------------------------------------------------

const KEYCLOAK_URL = import.meta.env['VITE_KEYCLOAK_URL'] as string | undefined ?? 'http://localhost:8080';
const KEYCLOAK_REALM = import.meta.env['VITE_KEYCLOAK_REALM'] as string | undefined ?? 'japan-trip';
const KEYCLOAK_CLIENT_ID = import.meta.env['VITE_KEYCLOAK_CLIENT_ID'] as string | undefined ?? 'japan-trip-frontend';

// ---------------------------------------------------------------------------
// Keycloak JS adapter instance (singleton)
// ---------------------------------------------------------------------------

const keycloak = new Keycloak({
  url: KEYCLOAK_URL,
  realm: KEYCLOAK_REALM,
  clientId: KEYCLOAK_CLIENT_ID,
});

// ---------------------------------------------------------------------------
// Initialization state
// ---------------------------------------------------------------------------

let initPromise: Promise<boolean> | null = null;

/**
 * Initialize the Keycloak adapter. Safe to call multiple times — returns the
 * same promise after the first call.
 *
 * Uses silent check-sso to restore an existing session without a full redirect.
 * Tokens are stored in sessionStorage (not localStorage) for better security.
 */
export async function initKeycloak(): Promise<boolean> {
  if (initPromise) return initPromise;

  // Build the silent-check-sso URI using Vite's BASE_URL so it works on
  // GitHub Pages (/PruebaMapJapan/) as well as localhost (/).
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  const silentCheckSsoRedirectUri =
    window.location.origin + base.replace(/\/$/, '') + '/silent-check-sso.html';

  initPromise = keycloak.init({
    onLoad: 'check-sso',
    silentCheckSsoRedirectUri,
    pkceMethod: 'S256',
    responseMode: 'fragment',
    checkLoginIframe: false,
  }).then((authenticated) => {
    if (import.meta.env.DEV) {
      const tokenState = !authenticated
        ? 'unauthenticated'
        : keycloak.token
          ? `token=present (sub=${keycloak.tokenParsed?.['sub']?.slice(0, 8)})`
          : 'WARN: authenticated=true but token=null — broken auth state';
      console.debug(`[auth] init: ${tokenState}`);
    }
    return authenticated;
  });

  keycloak.onTokenExpired = () => {
    if (import.meta.env.DEV) console.debug('[auth] token expired, refreshing');
    refreshToken().catch(() => {
      console.warn('[auth] token refresh failed — session may have expired');
    });
  };

  return initPromise;
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/**
 * Redirect to Keycloak login page with PKCE + passkey flow.
 */
export async function login(redirectUri?: string): Promise<void> {
  await keycloak.login({
    redirectUri: redirectUri ?? window.location.href,
    scope: 'openid profile email',
  });
}

/**
 * Redirect to Keycloak logout endpoint and clear the local session.
 */
export async function logout(redirectUri?: string): Promise<void> {
  await keycloak.logout({
    redirectUri: redirectUri ?? window.location.origin,
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

  // Refresh the token if it expires within 30 seconds
  try {
    await keycloak.updateToken(30);
  } catch {
    throw new Error('Failed to refresh access token — please log in again');
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
