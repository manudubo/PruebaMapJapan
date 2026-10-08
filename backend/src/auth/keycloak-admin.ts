import { log } from '../observability/logger';
import type { Env } from '../types';

/**
 * Keycloak Admin API client for ONE operation: set a user's password during
 * account recovery (routes/recovery.ts).
 *
 * Authentication: client_credentials for a dedicated confidential client
 * (KEYCLOAK_RECOVERY_CLIENT_ID, default `travelmap-recovery`, secret in
 * KEYCLOAK_RECOVERY_CLIENT_SECRET) whose service account has only the
 * realm-management roles view-users + manage-users. A fresh token is fetched
 * per recovery (rare, security-sensitive; nothing is cached or stored).
 *
 * Base URL: KEYCLOAK_ADMIN_URL, else KEYCLOAK_URL. Both may carry the `/auth`
 * path prefix (KC_HTTP_RELATIVE_PATH) and may be an internal address such as
 * http://keycloak:8080/auth; trailing slashes are ignored.
 *
 * Failure model - the route turns each kind into a response that does not
 * reveal Keycloak internals:
 *   unavailable    token/admin call failed: 401/403/5xx, network error,
 *                  timeout, unparseable answer. Retryable; "try again later".
 *   user_not_found no enabled Keycloak user has exactly this e-mail.
 *   ambiguous      more than one does (never guess which to reset).
 *   rejected       Keycloak refused the password (its own realm policy).
 * Nothing here logs the e-mail, the password, the secret or a token; log
 * lines carry the stage and HTTP status only.
 */
export type KeycloakAdminFailure = 'unavailable' | 'user_not_found' | 'ambiguous' | 'rejected';

export class KeycloakAdminError extends Error {
  readonly kind: KeycloakAdminFailure;
  constructor(kind: KeycloakAdminFailure) {
    super(`Keycloak admin call failed: ${kind}`);
    this.name = 'KeycloakAdminError';
    this.kind = kind;
  }
}

export const DEFAULT_RECOVERY_CLIENT_ID = 'travelmap-recovery';
export const KEYCLOAK_ADMIN_TIMEOUT_MS = 4000;
const MAX_RESPONSE_CHARS = 1_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let timeoutMs = KEYCLOAK_ADMIN_TIMEOUT_MS;
/** Test hook (a real timeout test cannot wait 4 s). Never called by production code. */
export function __setKeycloakAdminTimeoutForTests(ms: number | undefined): void {
  timeoutMs = ms ?? KEYCLOAK_ADMIN_TIMEOUT_MS;
}

type AdminEnv = Pick<
  Env,
  'KEYCLOAK_URL' | 'KEYCLOAK_REALM' | 'KEYCLOAK_ADMIN_URL' | 'KEYCLOAK_RECOVERY_CLIENT_ID' | 'KEYCLOAK_RECOVERY_CLIENT_SECRET'
>;

const trimSlashes = (u: string) => u.trim().replace(/\/+$/, '');

export interface RecoveryClientConfig {
  base: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}

/** null = account recovery is not configured (no secret, no base URL or no realm). */
export function recoveryClientConfig(env: AdminEnv): RecoveryClientConfig | null {
  const base = trimSlashes(env.KEYCLOAK_ADMIN_URL?.trim() ? env.KEYCLOAK_ADMIN_URL : (env.KEYCLOAK_URL ?? ''));
  const realm = (env.KEYCLOAK_REALM ?? '').trim();
  const clientSecret = env.KEYCLOAK_RECOVERY_CLIENT_SECRET ?? '';
  if (base === '' || realm === '' || clientSecret.trim() === '') return null;
  const clientId = env.KEYCLOAK_RECOVERY_CLIENT_ID?.trim() || DEFAULT_RECOVERY_CLIENT_ID;
  return { base, realm, clientId, clientSecret };
}

async function send(stage: string, url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    const text = (await res.text()).slice(0, MAX_RESPONSE_CHARS);
    return { status: res.status, text };
  } catch (err) {
    // Network error, timeout (AbortError/TimeoutError) or refused redirect.
    log.warn('recovery.keycloak_unreachable', { stage, reason: err instanceof Error ? err.name : 'unknown' });
    throw new KeycloakAdminError('unavailable');
  }
}

function parseJson(stage: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    log.warn('recovery.keycloak_bad_body', { stage });
    throw new KeycloakAdminError('unavailable');
  }
}

async function serviceToken(cfg: RecoveryClientConfig): Promise<string> {
  const { status, text } = await send('token', `${cfg.base}/realms/${encodeURIComponent(cfg.realm)}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }).toString(),
  });
  if (status !== 200) {
    // 401 = wrong/rotated secret, 5xx = Keycloak down: an operator problem either way.
    log.error('recovery.keycloak_token_failed', { status });
    throw new KeycloakAdminError('unavailable');
  }
  const token = (parseJson('token', text) as { access_token?: unknown } | null)?.access_token;
  if (typeof token !== 'string' || token === '' || token.length > 8192) {
    log.error('recovery.keycloak_token_failed', { status, reason: 'no access_token' });
    throw new KeycloakAdminError('unavailable');
  }
  return token;
}

/**
 * Set `password` (permanent, not temporary) for the Keycloak user whose e-mail
 * is exactly `email` (case-insensitive). Throws KeycloakAdminError.
 */
export const PASSKEY_ENROLMENT_ACTION = 'webauthn-register-passwordless';

export interface ResetOptions {
  /**
   * The account never proved its address (squatting case): also delete every
   * non-password credential (passkeys the squatter may have enrolled) and end
   * the user's sessions, so only the mailbox owner keeps access.
   */
  purgeOtherCredentials: boolean;
}

export async function resetKeycloakPassword(
  env: AdminEnv,
  email: string,
  password: string,
  opts: ResetOptions = { purgeOtherCredentials: false },
): Promise<void> {
  const cfg = recoveryClientConfig(env);
  if (!cfg) throw new KeycloakAdminError('unavailable');
  const admin = `${cfg.base}/admin/realms/${encodeURIComponent(cfg.realm)}`;
  const token = await serviceToken(cfg);
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const found = await send('find_user', `${admin}/users?${new URLSearchParams({ email, exact: 'true', max: '5' })}`, {
    method: 'GET',
    headers: auth,
  });
  if (found.status !== 200) {
    log.error('recovery.keycloak_admin_failed', { stage: 'find_user', status: found.status });
    throw new KeycloakAdminError('unavailable');
  }
  const list = parseJson('find_user', found.text);
  if (!Array.isArray(list)) throw new KeycloakAdminError('unavailable');
  const wanted = email.trim().toLowerCase();
  const matches = list.filter(
    (u): u is { id: string; email: string; enabled?: boolean; emailVerified?: boolean; requiredActions?: unknown } =>
      typeof u === 'object' && u !== null &&
      typeof (u as { id?: unknown }).id === 'string' && UUID_RE.test((u as { id: string }).id) &&
      typeof (u as { email?: unknown }).email === 'string' &&
      (u as { email: string }).email.trim().toLowerCase() === wanted &&
      (u as { enabled?: unknown }).enabled !== false,
  );
  if (matches.length === 0) throw new KeycloakAdminError('user_not_found');
  if (matches.length > 1) {
    log.error('recovery.keycloak_ambiguous_email', { matches: matches.length });
    throw new KeycloakAdminError('ambiguous');
  }

  const reset = await send('reset_password', `${admin}/users/${matches[0]!.id}/reset-password`, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
  if (reset.status === 204 || reset.status === 200) {
    await afterReset(admin, auth, matches[0]!, opts);
    return;
  }
  if (reset.status === 400) {
    log.warn('recovery.keycloak_password_rejected', { status: 400 });
    throw new KeycloakAdminError('rejected');
  }
  if (reset.status === 404) throw new KeycloakAdminError('user_not_found');
  log.error('recovery.keycloak_admin_failed', { stage: 'reset_password', status: reset.status });
  throw new KeycloakAdminError('unavailable');
}

/**
 * Best effort once the password is set (a failure here must not turn a
 * successful recovery into an error; it is logged for the operator):
 *  - drop the pending passkey-enrolment required action, otherwise a user
 *    without WebAuthn support loops on the enrolment page after signing in;
 *  - for a never-verified account, delete other credentials and log out.
 */
async function afterReset(
  admin: string,
  auth: Record<string, string>,
  user: { id: string; emailVerified?: boolean; requiredActions?: unknown },
  opts: ResetOptions,
): Promise<void> {
  const base = `${admin}/users/${user.id}`;
  const attempt = async (stage: string, run: () => Promise<{ status: number }>) => {
    try {
      const { status } = await run();
      if (status >= 400) log.error('recovery.keycloak_cleanup_failed', { stage, status });
    } catch {
      /* already logged by send() */
    }
  };

  const actions = Array.isArray(user.requiredActions) ? (user.requiredActions as unknown[]) : [];
  if (actions.includes(PASSKEY_ENROLMENT_ACTION)) {
    await attempt('required_actions', () =>
      send('required_actions', base, {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requiredActions: actions.filter((a) => a !== PASSKEY_ENROLMENT_ACTION) }),
      }),
    );
  }

  if (opts.purgeOtherCredentials && user.emailVerified !== true) {
    try {
      const list = await send('credentials', `${base}/credentials`, { method: 'GET', headers: auth });
      const creds = list.status === 200 ? parseJson('credentials', list.text) : [];
      for (const c of Array.isArray(creds) ? creds : []) {
        const id = (c as { id?: unknown }).id;
        if ((c as { type?: unknown }).type === 'password' || typeof id !== 'string' || !UUID_RE.test(id)) continue;
        await attempt('delete_credential', () => send('delete_credential', `${base}/credentials/${id}`, { method: 'DELETE', headers: auth }));
      }
    } catch {
      /* logged */
    }
    await attempt('logout', () => send('logout', `${base}/logout`, { method: 'POST', headers: auth }));
  }
}
