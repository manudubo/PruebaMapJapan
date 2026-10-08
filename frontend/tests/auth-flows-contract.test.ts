import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('@/auth/keycloak', () => ({
  getToken: vi.fn(async () => 'tok'),
  isAuthenticated: vi.fn(() => true),
}));

import { authPost, classifyCodeProblem } from '@/api/authFlows';

// The same file the backend test checks against its real routes
// (backend/src/routes/auth-flows-contract.test.ts).
interface Case {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  frontend: { ok: boolean; error: string | null; retryAfter: number | null; problem: string | null };
}
const { cases } = JSON.parse(
  readFileSync(join(__dirname, '../../contracts/auth-flows.json'), 'utf8'),
) as { cases: Case[] };

const fill = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/"<number>"/g, '42')) as T;

describe('auth-flows wire contract (shared with the backend)', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify(fill(c.body)), { status: c.status, headers: fill(c.headers ?? {}) }),
    ) as typeof fetch;
    const r = await authPost('/auth/x', {}, false);
    expect(r.ok).toBe(c.frontend.ok);
    expect(r.error).toBe(c.frontend.error);
    expect(r.retryAfter).toBe(c.frontend.retryAfter);
    if (!c.frontend.ok) expect(classifyCodeProblem(r)).toBe(c.frontend.problem);
  });
});
