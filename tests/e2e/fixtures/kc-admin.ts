import KcAdminClient from '@keycloak/keycloak-admin-client';
import { test as base, expect } from '@playwright/test';
import postgres from 'postgres';

async function buildAdminClient(): Promise<KcAdminClient> {
  const client = new KcAdminClient({
    baseUrl: process.env.KEYCLOAK_URL ?? 'http://localhost:8080',
    realmName: process.env.KEYCLOAK_REALM ?? 'japan-trip',
  });
  await client.auth({
    grantType: 'client_credentials',
    clientId: process.env.KC_ADMIN_CLIENT_ID!,
    clientSecret: process.env.KC_ADMIN_CLIENT_SECRET!,
  });
  return client;
}

export async function createUser(
  username: string,
  password: string,
  email?: string,
): Promise<void> {
  const client = await buildAdminClient();
  await client.users.create({
    username,
    email: email ?? username,
    emailVerified: true,
    enabled: true,
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
}

export async function deleteUser(username: string): Promise<void> {
  const client = await buildAdminClient();
  const [user] = await client.users.find({ username, exact: true });
  if (!user?.id) return; // idempotent — no-op if user doesn't exist
  await client.users.del({ id: user.id });
}

export async function resetCredentials(username: string): Promise<void> {
  const client = await buildAdminClient();
  const [user] = await client.users.find({ username, exact: true });
  if (!user?.id) throw new Error(`User not found: ${username}`);
  const credentials = await client.users.getCredentials({ id: user.id });
  for (const cred of credentials) {
    // Remove WebAuthn credentials; leave password credential intact
    if (cred.type === 'webauthn-passwordless' || cred.type === 'webauthn') {
      await client.users.deleteCredential({ id: user.id, credentialId: cred.id! });
    }
  }
}

export async function clearOtpCodes(username: string): Promise<void> {
  // email_otp_codes lives in Postgres (BACK-03); KC Admin has no such endpoint
  const sql = postgres(process.env.POSTGRES_URL!);
  try {
    await sql`
      DELETE FROM email_otp_codes
      WHERE user_id = (SELECT id FROM users WHERE email = ${username})
    `;
  } finally {
    await sql.end();
  }
}

export async function expireOtpCodes(username: string): Promise<void> {
  // Back-dates expires_at to one minute ago for all unused codes belonging to username.
  // Enables the expired-OTP test without requiring real time to pass or a test-only API.
  const sql = postgres(process.env.POSTGRES_URL!);
  try {
    await sql`
      UPDATE email_otp_codes
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE user_id = (SELECT id FROM users WHERE email = ${username})
        AND used_at IS NULL
    `;
  } finally {
    await sql.end();
  }
}

// Playwright fixture — extend base test with kcAdmin object
export const test = base.extend<{
  kcAdmin: {
    resetCredentials: typeof resetCredentials;
    clearOtpCodes: typeof clearOtpCodes;
    expireOtpCodes: typeof expireOtpCodes;
    createUser: typeof createUser;
    deleteUser: typeof deleteUser;
  };
}>({
  kcAdmin: async ({}, use) => {
    await use({ resetCredentials, clearOtpCodes, expireOtpCodes, createUser, deleteUser });
  },
});

export { expect } from '@playwright/test';
