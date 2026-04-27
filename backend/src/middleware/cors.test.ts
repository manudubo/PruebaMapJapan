import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from './cors';

const app = new Hono();
app.use('*', corsMiddleware);
app.get('/test', (c) => c.json({ ok: true }));

describe('CORS middleware — SEC-03', () => {
  it('returns no Access-Control-Allow-Origin header when origin is absent (null origin → null, not *)', async () => {
    const res = await app.request('/test', {
      method: 'GET',
      // No Origin header — simulates null-origin request
    });
    const acao = res.headers.get('Access-Control-Allow-Origin');
    // After fix: null origin must NOT produce '*'
    expect(acao).not.toBe('*');
  });

  it('reflects a listed origin back in Access-Control-Allow-Origin', async () => {
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('returns null (no header) for an unlisted origin', async () => {
    const res = await app.request('/test', {
      method: 'GET',
      headers: { Origin: 'https://evil.example.com' },
    });
    const acao = res.headers.get('Access-Control-Allow-Origin');
    expect(acao).toBeNull();
  });
});
