// The dashboard's OTP calls used root-relative fetch('/api/auth/...'): on GitHub Pages that
// requests https://<user>.github.io/api/... (Pages 404), never the backend at VITE_API_URL.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

vi.mock('@/auth/keycloak', () => ({
  keycloak: { login: vi.fn().mockResolvedValue(undefined) },
  initKeycloak: vi.fn().mockResolvedValue(true),
  retryAuth: vi.fn().mockResolvedValue(true),
  getAuthStatus: vi.fn().mockReturnValue('authenticated'),
  getAuthUnavailableReason: vi.fn().mockReturnValue(null),
  onAuthStatusChange: vi.fn().mockReturnValue(() => {}),
  getUserInfo: vi.fn().mockReturnValue({ id: 'u1', email: 'a@b.c', name: 'A' }),
  getToken: vi.fn().mockResolvedValue('tok'),
  isAuthenticated: vi.fn().mockReturnValue(true),
  login: vi.fn(),
}));
vi.mock('@/modules/passkeyCampaign', () => ({ checkPasskeyCampaign: vi.fn() }));

import { apiUrl } from '@/api/client';
import { handleVerifyOtp } from '@/pages/dashboard';

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:8787/api';

describe('OTP endpoints use the API base', () => {
  beforeEach(() => {
    document.body.innerHTML = '<input id="otp-code-input" value="123456" /><p id="otp-error" hidden></p>';
  });

  it('apiUrl joins the configured base', () => {
    expect(apiUrl('/auth/otp-verify')).toBe(`${API_BASE}/auth/otp-verify`);
  });

  it('handleVerifyOtp posts to <VITE_API_URL>/auth/otp-verify, not a page-relative /api path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
    global.fetch = fetchMock;
    await handleVerifyOtp(true);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toBe(`${API_BASE}/auth/otp-verify`);
    expect(url.startsWith('/')).toBe(false);
  });

  it('no frontend source fetches a root-relative /api path', () => {
    const root = resolve(__dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [join(dir, e.name)] : [],
      );
    const offenders = walk(root).filter((f) => /fetch\(\s*['"`]\/api\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
