/**
 * Local development entry point — uses @hono/node-server instead of Cloudflare Workers.
 * Reads env vars from .env file and injects them into Hono's binding context.
 *
 * Usage: npm run dev   (runs: tsx watch src/dev.ts)
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './index';

const PORT = Number(process.env.PORT) || 8787;

// Inject process.env as Hono bindings (equivalent to c.env in Workers)
const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  KEYCLOAK_URL: process.env.KEYCLOAK_URL ?? '',
  KEYCLOAK_REALM: process.env.KEYCLOAK_REALM ?? '',
  VALID_AUDIENCES: process.env.VALID_AUDIENCES ?? '',
  KC_ADMIN_CLIENT_ID: process.env.KC_ADMIN_CLIENT_ID ?? '',
  KC_ADMIN_CLIENT_SECRET: process.env.KC_ADMIN_CLIENT_SECRET ?? '',
  OTP_SECRET: process.env.OTP_SECRET ?? '',
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

serve(
  {
    fetch: (req) => app.fetch(req, env),
    port: PORT,
  },
  () => {
    console.log(`\n Backend running at http://localhost:${PORT}`);
    console.log(`  Health: http://localhost:${PORT}/api/health`);
    console.log(`  DB:     ${env.DATABASE_URL || '(not set)'}`);
    console.log(`  KC:     ${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}\n`);
  },
);
