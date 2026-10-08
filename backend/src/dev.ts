/**
 * Local development entry point — uses @hono/node-server instead of Cloudflare Workers.
 * Reads env vars from .env file and injects them into Hono's binding context.
 *
 * Usage: npm run dev   (runs: tsx watch src/dev.ts)
 */

import dotenv from 'dotenv';
// tsx does not load Wrangler's .dev.vars automatically — load it explicitly.
dotenv.config({ path: '.dev.vars' });
import { serve } from '@hono/node-server';
import app from './index';
import { SERVER_ENV_CONTRACT } from './node/config';

const PORT = Number(process.env.PORT) || 8787;

function redactUrlPassword(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return raw ? '(unparseable URL)' : '';
  }
}

// Inject process.env as Hono bindings (equivalent to c.env in Workers)
const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  // Node dev server → TCP driver unless overridden (ARCH-02).
  DB_DRIVER: process.env.DB_DRIVER ?? 'pg',
  KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? '',
  KEYCLOAK_REALM: process.env.KEYCLOAK_REALM ?? '',
  VALID_AUDIENCES: process.env.VALID_AUDIENCES ?? '',
  KC_ADMIN_CLIENT_ID: process.env.KC_ADMIN_CLIENT_ID ?? '',
  KC_ADMIN_CLIENT_SECRET: process.env.KC_ADMIN_CLIENT_SECRET ?? '',
  OTP_SECRET: process.env.OTP_SECRET ?? '',
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  // This entry point only ever runs locally, so default to development.
  ENVIRONMENT: process.env.ENVIRONMENT ?? 'development',
};

// Everything else the app reads (SMTP_*, EMAIL_*, REQUIRE_VERIFIED_EMAIL, KEYCLOAK_RECOVERY_*,
// ALLOWED_ORIGINS, ...): without this the sign-up e-mail verification and recovery flows
// cannot be run (or end-to-end tested) against the dev server.
const bindings: Record<string, string | undefined> = env;
for (const key of SERVER_ENV_CONTRACT) {
  const value = process.env[key];
  if (bindings[key] === undefined && value !== undefined) bindings[key] = value;
}

serve(
  {
    fetch: (req) => app.fetch(req, env),
    port: PORT,
  },
  () => {
    console.log(`\n Backend running at http://localhost:${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/api/health`);
    // Never print the DB password (shell history, screen shares, CI logs).
    console.log(`  DB:     ${redactUrlPassword(env.DATABASE_URL) || '(not set)'}`);
    console.log(`  KC:     ${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}\n`);
  },
);
