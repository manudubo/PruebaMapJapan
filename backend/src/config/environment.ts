/**
 * Deployment environment, read from the explicit `ENVIRONMENT` binding.
 *
 * Fail-closed: only the exact value "development" (case/whitespace-insensitive)
 * enables development behaviour (localhost CORS origins, Mailpit email). Any
 * other value — including a missing or misspelled binding — is treated as
 * production, so a config mistake can never silently relax prod security.
 */
export type AppEnvironment = 'development' | 'production';

export function resolveEnvironment(value: string | undefined | null): AppEnvironment {
  return typeof value === 'string' && value.trim().toLowerCase() === 'development'
    ? 'development'
    : 'production';
}

export function isDevelopment(env: { ENVIRONMENT?: string } | undefined | null): boolean {
  return resolveEnvironment(env?.ENVIRONMENT) === 'development';
}
