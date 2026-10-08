import type { Page } from '@playwright/test';
import type { ApiCall } from './mockApi';

/**
 * Fakes for the sign-up / recovery code flows, so specs run without Keycloak or a backend:
 *
 *   POST /api/auth/email-verify/request            (authenticated)
 *   POST /api/auth/email-verify/confirm   {code}   (authenticated)
 *   POST /api/auth/recovery/request       {email}  (anonymous, always generic)
 *   POST /api/auth/recovery/confirm {email, code, new_password}
 *
 * and for Keycloak's account REST API (`/account/credentials?type=...`), which the passkey
 * onboarding uses to learn whether the user already has a passkey or a password.
 *
 * Register AFTER mockApi(): Playwright runs the most recently registered matching route first,
 * so these answer before mockApi's catch-all.
 */

export interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface AuthFlowMockOptions {
  /** The valid 6-digit code for both flows. */
  code?: string;
  /** Flipped to true by a successful email-verify/confirm; share with mockApi({ verification }). */
  verification?: { verified: boolean };
  /** Override the n-th (1-based) answer of an endpoint. */
  verifyRequest?: (n: number) => FakeResponse | undefined;
  verifyConfirm?: (code: string, n: number) => FakeResponse | undefined;
  recoveryRequest?: (email: string, n: number) => FakeResponse | undefined;
  recoveryConfirm?: (body: { email: string; code: string; new_password: string }, n: number) => FakeResponse | undefined;
  /** Delay (ms) before answering confirm calls, to probe double submits. */
  confirmDelayMs?: number;
}

const json = (r: FakeResponse) => ({
  status: r.status,
  headers: r.headers,
  contentType: 'application/json',
  body: r.status === 204 ? '' : JSON.stringify(r.body ?? {}),
});

export async function mockAuthFlows(page: Page, options: AuthFlowMockOptions = {}): Promise<ApiCall[]> {
  const validCode = options.code ?? '123456';
  const calls: ApiCall[] = [];
  const counts: Record<string, number> = {};

  await page.route('**/api/auth/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*?\/api/, '');
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    let body: Record<string, string> = {};
    try {
      body = JSON.parse(request.postData() ?? '{}') as Record<string, string>;
    } catch {
      // empty body
    }
    calls.push({ method: request.method(), path, body });
    const n = (counts[path] = (counts[path] ?? 0) + 1);

    if (path === '/auth/email-verify/request') {
      return route.fulfill(json(options.verifyRequest?.(n) ?? { status: 204 }));
    }
    if (path === '/auth/email-verify/confirm') {
      if (options.confirmDelayMs) await new Promise((r) => setTimeout(r, options.confirmDelayMs));
      const override = options.verifyConfirm?.(body['code'] ?? '', n);
      if (override) return route.fulfill(json(override));
      if (body['code'] === validCode) {
        if (options.verification) options.verification.verified = true;
        return route.fulfill(json({ status: 200, body: { success: true } }));
      }
      return route.fulfill(json({ status: 400, body: { success: false, code: 'invalid_code', attemptsLeft: Math.max(0, 5 - n) } }));
    }
    if (path === '/auth/recovery/request') {
      // Same answer for every address: the real endpoint must not reveal whether one exists.
      return route.fulfill(json(options.recoveryRequest?.(body['email'] ?? '', n) ?? { status: 202, body: { success: true } }));
    }
    if (path === '/auth/recovery/confirm') {
      const override = options.recoveryConfirm?.(body as { email: string; code: string; new_password: string }, n);
      if (override) return route.fulfill(json(override));
      if (body['code'] === validCode && (body['new_password'] ?? '').length >= 12) {
        return route.fulfill(json({ status: 200, body: { success: true } }));
      }
      return route.fulfill(json({ status: 400, body: { success: false, code: 'invalid_code' } }));
    }
    return route.fulfill(json({ status: 404, body: { success: false, code: 'not_found' } }));
  });

  return calls;
}

/**
 * Keycloak account API: how many credentials of each type the user has
 * (`GET /realms/<realm>/account/credentials?type=webauthn-passwordless|password`).
 * Register AFTER mockKeycloak*(): it must win over the blanket `**\/realms/**` mock.
 */
export async function mockAccountCredentials(
  page: Page,
  counts: { passkeys?: number; passwords?: number } = {},
): Promise<void> {
  await page.route('**/realms/*/account/credentials**', async (route) => {
    const request = route.request();
    const origin = request.headers()['origin'];
    const cors = {
      'access-control-allow-origin': origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, authorization, accept',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const type = new URL(request.url()).searchParams.get('type') ?? '';
    const n = type === 'password' ? (counts.passwords ?? 0) : (counts.passkeys ?? 0);
    const credential = (i: number) => ({
      credential: { id: `c${i}`, type, userLabel: `${type} ${i}`, createdDate: 1_700_000_000_000 + i },
    });
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify([{ type, userCredentialMetadatas: Array.from({ length: n }, (_v, i) => credential(i)) }]),
    });
  });
}

/** Init script: this browser can create a passkey (headless Chromium has no platform authenticator). */
export const WEBAUTHN_SUPPORTED = `
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true, writable: true,
    value: Object.assign(function PublicKeyCredential() {}, {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    }),
  });
`;

/** Init script: no WebAuthn at all (old browsers, privacy extensions). */
export const WEBAUTHN_UNSUPPORTED = `
  try { delete window.PublicKeyCredential; } catch (e) {}
  Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, writable: true, value: undefined });
`;
