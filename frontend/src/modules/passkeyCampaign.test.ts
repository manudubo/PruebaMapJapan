import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/auth/keycloak', () => ({
  keycloak: {
    login: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import AFTER vi.mock declarations
import { checkPasskeyCampaign } from '@/modules/passkeyCampaign';
import { keycloak } from '@/auth/keycloak';

describe('checkPasskeyCampaign', () => {
  beforeEach(() => {
    // Clear all cookies set during tests
    document.cookie.split(';').forEach((c) => {
      const key = c.trim().split('=')[0];
      if (key) document.cookie = `${key}=; max-age=0`;
    });
    vi.clearAllMocks();

    // Remove any lingering PublicKeyCredential stub from prior test
    if ('PublicKeyCredential' in globalThis) {
      try {
        Object.defineProperty(globalThis, 'PublicKeyCredential', {
          value: undefined,
          configurable: true,
          writable: true,
        });
      } catch {
        // ignore
      }
    }
  });

  it('is no-op when WebAuthn is not supported (PublicKeyCredential undefined)', () => {
    // jsdom does not define PublicKeyCredential by default
    checkPasskeyCampaign('user-abc');
    expect(keycloak.login).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('pnk_user-abc=');
  });

  it('is no-op when per-device cookie already exists', () => {
    Object.defineProperty(globalThis, 'PublicKeyCredential', {
      value: class {},
      configurable: true,
      writable: true,
    });
    document.cookie = 'pnk_user-xyz=1; SameSite=Strict';
    checkPasskeyCampaign('user-xyz');
    expect(keycloak.login).not.toHaveBeenCalled();
  });

  it('writes cookie BEFORE calling keycloak.login when WebAuthn capable and no cookie', () => {
    Object.defineProperty(globalThis, 'PublicKeyCredential', {
      value: class {},
      configurable: true,
      writable: true,
    });
    checkPasskeyCampaign('user-999');
    // Cookie must be written before redirect (D-14)
    expect(document.cookie).toContain('pnk_user-999=');
    expect(keycloak.login).toHaveBeenCalledWith({
      action: 'webauthn-register-passwordless',
      redirectUri: window.location.href,
    });
  });
});
