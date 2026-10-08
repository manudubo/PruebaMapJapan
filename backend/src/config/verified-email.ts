import { isDevelopment } from './environment';

/**
 * REQUIRE_VERIFIED_EMAIL: must an account have a verified e-mail address to
 * use the API (everything except GET/PATCH /api/users/me, the e-mail
 * verification endpoints and health)?
 *
 *   unset                  production -> true, development -> false
 *   "true" / "false"       explicit (case and whitespace insensitive)
 *   anything else          true: a typo can only make the API stricter
 *
 * Fail-closed like config/environment.ts: a missing ENVIRONMENT is production.
 */
export function verifiedEmailRequired(
  env: { ENVIRONMENT?: string; REQUIRE_VERIFIED_EMAIL?: string } | undefined | null,
): boolean {
  const raw = env?.REQUIRE_VERIFIED_EMAIL?.trim().toLowerCase();
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  if (raw === undefined || raw === '') return !isDevelopment(env);
  return true;
}

/** Valid spellings, for boot-time validation (node/config.ts). */
export function isValidVerifiedEmailSetting(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === undefined || v === '' || v === 'true' || v === 'false';
}
