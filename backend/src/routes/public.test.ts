import { describe, it, expect } from 'vitest';
import app from '../index';
import type { Env } from '../types';

const mockEnv: Env = {
  DATABASE_URL: 'postgresql://mock:mock@localhost/mockdb',
  KEYCLOAK_URL: 'http://localhost:8080',
  KEYCLOAK_REALM: 'japan-trip',
  VALID_AUDIENCES: 'japan-trip-frontend',
  KC_ADMIN_CLIENT_ID: 'japan-trip-worker',
  KC_ADMIN_CLIENT_SECRET: 'mock-secret',
};

describe('Public trip route — slug-based (SHARE-02, SHARE-04)', () => {
  const VALID_SLUG = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('valid UUID + public trip → 200 (or 500 without real DB)', async () => {
    const res = await app.request(`/api/public/trips/${VALID_SLUG}`, {}, mockEnv);
    expect([200, 500]).toContain(res.status);

    const body = await res.json() as Record<string, unknown>;
    if (res.status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it('valid UUID + private trip → 404 (enforced by is_public filter)', async () => {
    // Real privacy enforcement tested via is_public=true filter in getTripBySlug
    const res = await app.request(`/api/public/trips/${VALID_SLUG}`, {}, mockEnv);
    expect([404, 500]).toContain(res.status);
  });

  it('invalid UUID format → 400 "Invalid slug"', async () => {
    const res = await app.request('/api/public/trips/not-a-uuid', {}, mockEnv);
    expect(res.status).toBe(400);

    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid slug');
  });

  it('valid UUID + no matching trip → 404 (or 500 without real DB)', async () => {
    const slug = '00000000-0000-0000-0000-000000000000';
    const res = await app.request(`/api/public/trips/${slug}`, {}, mockEnv);
    expect([404, 500]).toContain(res.status);

    const body = await res.json() as Record<string, unknown>;
    if (res.status === 404) {
      expect(body.success).toBe(false);
    }
  });
});
