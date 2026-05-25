import { keycloak } from '@/auth/keycloak';

export function checkPasskeyCampaign(userId: string): void {
  // WebAuthn capability check (D-12)
  if (typeof PublicKeyCredential === 'undefined') return;

  // Per-device cookie check — equals sign prevents prefix collision with longer userIds (D-13)
  if (document.cookie.includes(`pnk_${userId}=`)) return;

  // Write cookie BEFORE redirect to prevent loop if KC registration fails (D-14)
  // No Secure flag — would block cookie on http://localhost
  document.cookie = `pnk_${userId}=1; max-age=2592000; SameSite=Strict`;

  // Redirect to passkey registration AIA (D-15)
  void keycloak.login({
    action: 'webauthn-register-passwordless',
    redirectUri: window.location.href,
  });
}
