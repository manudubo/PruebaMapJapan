/**
 * Is self-registration ("Sign up") offered? Pure, dependency-free: shared by the app
 * (src/auth/registration.ts) and the build (build/signupGatePlugin.ts).
 *
 * VITE_REGISTRATION_ENABLED=false|0|off turns it off, true|1|on forces it on; unset (or
 * anything else) means "on when a real Keycloak is configured" (VITE_KEYCLOAK_URL), so
 * demo-only builds without Keycloak never show it.
 */
export interface RegistrationEnv {
  flag: string | undefined;
  keycloakUrl: string | undefined;
}

export function isRegistrationEnabled(env: RegistrationEnv): boolean {
  const flag = (env.flag ?? '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'off') return false;
  if (flag === 'true' || flag === '1' || flag === 'on') return true;
  return (env.keycloakUrl ?? '').trim() !== '';
}
