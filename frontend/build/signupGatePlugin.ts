import type { Plugin } from 'vite';
import { isRegistrationEnabled } from '../src/auth/registrationFlag';

/**
 * "Sign up" buttons in the static HTML carry `data-signup`. When registration is off for
 * this build (src/auth/registrationFlag.ts), they are emitted `hidden`, so the page never
 * paints a button that a script then removes (no layout shift, nothing to click in a
 * demo-only build). The same env Vite bakes into import.meta.env decides.
 */
export function gateSignupHtml(html: string, enabled: boolean): string {
  return enabled ? html : html.replace(/(<[a-z]+\b[^>]*?\s)data-signup(?=[\s>])/g, '$1hidden data-signup');
}

export function signupGatePlugin(): Plugin {
  let enabled = true;
  return {
    name: 'signup-gate',
    configResolved(config) {
      const env = config.env as Record<string, string | undefined>;
      enabled = isRegistrationEnabled({
        flag: env['VITE_REGISTRATION_ENABLED'],
        keycloakUrl: env['VITE_KEYCLOAK_URL'],
      });
    },
    transformIndexHtml(html) {
      return gateSignupHtml(html, enabled);
    },
  };
}
