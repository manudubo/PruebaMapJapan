import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock keycloak singleton before any dashboard import
vi.mock('@/auth/keycloak', () => ({
  keycloak: {
    login: vi.fn().mockResolvedValue(undefined),
  },
  initKeycloak: vi.fn().mockResolvedValue(true),
  getUserInfo: vi.fn().mockReturnValue({ id: 'user-test-01', email: 'test@example.com' }),
  getToken: vi.fn().mockResolvedValue('mock-bearer-token'),
  login: vi.fn(),
}));

vi.mock('@/modules/passkeyCampaign', () => ({
  checkPasskeyCampaign: vi.fn(),
}));

// handleVerifyOtp is not exported by dashboard.ts directly — these tests import
// the function under test via a named re-export that 08-07 must add.
// If the import fails, tests are RED (correct state before 08-07).
import { handleVerifyOtp } from '@/pages/dashboard';
import { keycloak } from '@/auth/keycloak';

describe('dashboard handleVerifyOtp — PASS-07 UPDATE_PASSWORD gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up a minimal OTP input element in jsdom
    document.body.innerHTML = `
      <input id="otp-code-input" value="123456" />
      <p id="otp-error" hidden></p>
      <div id="otp-modal-overlay"></div>
    `;
  });

  it('calls keycloak.login UPDATE_PASSWORD when webauthnCapable is false and OTP verify returns 200', async () => {
    // Arrange: mock fetch to return 200
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    // Act: call with webauthnCapable = false (non-WebAuthn device)
    await handleVerifyOtp(false);

    // Assert: UPDATE_PASSWORD AIA fired (D-21)
    expect(keycloak.login).toHaveBeenCalledWith({
      action: 'UPDATE_PASSWORD',
      redirectUri: window.location.href,
    });
  });

  it('does NOT call keycloak.login UPDATE_PASSWORD when webauthnCapable is true and OTP verify returns 200', async () => {
    // Arrange: mock fetch to return 200
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    // Act: call with webauthnCapable = true (passkey-capable device)
    await handleVerifyOtp(true);

    // Assert: no UPDATE_PASSWORD redirect on capable devices (D-21)
    expect(keycloak.login).not.toHaveBeenCalled();
  });
});
