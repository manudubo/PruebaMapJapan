/**
 * Route-test helpers. Pair with this mock at the top of the test file (vi.mock
 * is hoisted, so it must live in the test file itself):
 *
 *   vi.mock('../middleware/auth', () => import('../test-utils/fake-auth'));
 *
 * The fake auth middleware trusts the `x-test-sub` header as the Keycloak
 * subject, so a test can act as any user without real JWTs. Everything after
 * authentication (provisioning, routes, SQL) is the real code.
 */
import app from '../index';
import type { Env } from '../types';
import { testEnv, testPool } from './db';

export interface CallResult {
  status: number;
  body: Record<string, unknown>;
}

export async function call(
  method: string,
  path: string,
  opts: {
    sub?: string;
    body?: unknown;
    rawBody?: string;
    env?: Env;
    headers?: Record<string, string>;
  } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.sub !== undefined) headers['x-test-sub'] = opts.sub;
  let body: string | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    headers['Content-Type'] = 'application/json';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await app.request(path, { method, headers, body }, opts.env ?? testEnv());
  const text = await res.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

/** Every row of every app table — compare before/after to prove "no write". */
export async function snapshotDb(): Promise<string> {
  const tables = ['users', 'trips', 'destinations', 'hotels', 'days', 'activities', 'email_otp_codes'];
  const parts: unknown[] = [];
  for (const t of tables) {
    const { rows } = await testPool().query(`SELECT * FROM ${t} ORDER BY id`);
    parts.push(rows);
  }
  return JSON.stringify(parts);
}
