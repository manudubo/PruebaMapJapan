import type { Page, Route } from '@playwright/test';

/**
 * Keycloak network mocks for specs that must run without a Keycloak server
 * (the CI `e2e` job runs with SKIP_REAL_AUTH against a `vite preview` build).
 *
 * Why this exists: the app calls keycloak-js `check-sso` on load. keycloak-js
 * first loads a 3rd-party-cookie iframe (`.../3p-cookies/step1.html`) and waits
 * `messageReceiveTimeout` (10 s) for a postMessage before it gives up. A blanket
 * `page.route('**\/realms\/**', ...200 {})` never sends that message, so the
 * dashboard stayed in its pre-init state for ~10 s — longer than the 5-10 s
 * assertion timeouts — which is the `#trips-grid` / `#dashboard-login-prompt`
 * visibility timeout that made the CI e2e job fail on every run (ARCH-09).
 *
 * These helpers answer every step of the check-sso handshake immediately.
 */

// keycloak-js sends the token request with credentials, so a wildcard origin is rejected.
function cors(origin: string | undefined): Record<string, string> {
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, authorization',
  };
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fakeJwt(claims: Record<string, unknown>): string {
  // keycloak-js decodes but does not verify signatures; the backend is mocked.
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.sig`;
}

export interface MockKeycloakUser {
  sub: string;
  name: string;
  email: string;
  preferred_username: string;
}

export const DEFAULT_MOCK_USER: MockKeycloakUser = {
  sub: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  preferred_username: 'testuser',
};

async function installKeycloakMock(page: Page, user: MockKeycloakUser | null, initialNonce = ''): Promise<void> {
  let nonce = initialNonce;

  await page.route('**/realms/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const CORS = cors(request.headers()['origin']);

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS });
    }

    // Step 1: 3rd-party cookie check iframe — report "supported" immediately.
    if (url.pathname.endsWith('/3p-cookies/step1.html')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<script>parent.postMessage("supported","*")</script>',
      });
    }

    // A user-initiated top-level navigation (login()/logout()) must stay on the
    // Keycloak URL so specs can assert it; only the silent iframe gets redirected back.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Mock Keycloak</title><h1 id="mock-kc">Mock Keycloak</h1>',
      });
    }

    // Step 2: silent check-sso iframe navigation to the auth endpoint.
    if (url.pathname.endsWith('/protocol/openid-connect/auth')) {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      nonce = url.searchParams.get('nonce') ?? '';
      const fragment = user
        ? `code=mock-code&state=${state}&session_state=mock-session`
        : `error=login_required&state=${state}`;
      return route.fulfill({ status: 302, headers: { location: `${redirectUri}#${fragment}` } });
    }

    // Step 3 (authenticated only): code -> token exchange.
    if (user && url.pathname.endsWith('/protocol/openid-connect/token')) {
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        ...user,
        nonce,
        iat: now,
        exp: now + 3600,
        iss: `${url.origin}/realms/japan-trip`,
        aud: 'japan-trip-frontend',
        typ: 'Bearer',
      };
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: fakeJwt(claims),
          refresh_token: fakeJwt({ ...claims, typ: 'Refresh' }),
          token_type: 'Bearer',
          expires_in: 3600,
          session_state: 'mock-session',
        }),
      });
    }

    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
  });
}

/** keycloak-js resolves `check-sso` as "no session" (guest) without waiting on timeouts. */
export function mockKeycloakLoggedOut(page: Page): Promise<void> {
  return installKeycloakMock(page, null);
}

export interface LoggedInOptions {
  user?: MockKeycloakUser;
  /**
   * The dashboard sends a first-time WebAuthn-capable user to Keycloak's passkey
   * registration (once per device, tracked by the `pnk_<sub>` cookie). Default
   * true pre-sets that cookie so specs land on the dashboard; pass false to
   * exercise the campaign itself.
   */
  passkeyCampaignDone?: boolean;
  /** Nonce for the first token answer (a login started before this mock was installed). */
  nonce?: string;
}

/** keycloak-js resolves `check-sso` as authenticated with a fake (unsigned) token. */
export async function mockKeycloakLoggedIn(page: Page, options: LoggedInOptions = {}): Promise<void> {
  const user = options.user ?? DEFAULT_MOCK_USER;
  if (options.passkeyCampaignDone ?? true) {
    await page.context().addCookies([{ name: `pnk_${user.sub}`, value: '1', domain: 'localhost', path: '/' }]);
  }
  await installKeycloakMock(page, user, options.nonce);
}

/**
 * Finish a login that the app started with a top-level navigation to the
 * authorize endpoint (`authorizeUrl`, e.g. from page.waitForRequest): from now
 * on Keycloak answers as signed in, and the browser is sent to the request's
 * redirect_uri with a code in the fragment, as Keycloak's 302 would do. The
 * token carries that request's nonce, so keycloak-js accepts it.
 */
export async function completeMockLogin(page: Page, authorizeUrl: URL, options: LoggedInOptions = {}): Promise<void> {
  const redirectUri = authorizeUrl.searchParams.get('redirect_uri');
  const state = authorizeUrl.searchParams.get('state');
  if (!redirectUri || !state) throw new Error(`not an authorize request: ${authorizeUrl.href}`);
  await page.unroute('**/realms/**');
  await mockKeycloakLoggedIn(page, { ...options, nonce: authorizeUrl.searchParams.get('nonce') ?? '' });
  await page.goto(`${redirectUri}#state=${encodeURIComponent(state)}&session_state=mock-session&code=mock-code`);
}
