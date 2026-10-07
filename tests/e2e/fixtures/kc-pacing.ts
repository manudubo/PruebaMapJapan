import { expect } from '@playwright/test';

/**
 * Keycloak's brute-force detector counts two login failures closer together than the
 * realm's quick_login_check_milli_seconds (1000 in both Terraform profiles) as a bot
 * and locks the account ("quick login" lockout, see idp-hardening.spec.ts).
 *
 * Tests that need *human-paced* failures call `failed()` right after Keycloak has
 * answered a failed attempt, and `humanPause()` before the next one. The pause is not a
 * fixed sleep: it waits for a condition (more than the quick-login window has passed
 * since that observed failure response), so it returns at once when the test was already
 * slower than the window, and it times out loudly instead of hanging. Measuring from the
 * response we received (which Keycloak sent after recording the failure) can only
 * over-estimate the server-side gap, never under-estimate it.
 */
export const QUICK_LOGIN_WINDOW_MS = 1000;
/** Margin over the window for clock granularity between Keycloak and the runner. */
const MARGIN_MS = 300;

export class FailurePacer {
  private lastFailureAt: number | null = null;

  /** Record that Keycloak has just answered a failed attempt. */
  failed(): void {
    this.lastFailureAt = Date.now();
  }

  /** Resolve once the quick-login window since the last recorded failure has elapsed. */
  async humanPause(): Promise<void> {
    const since = this.lastFailureAt;
    expect(since, 'humanPause() needs a failure recorded with failed()').not.toBeNull();
    const gap = QUICK_LOGIN_WINDOW_MS + MARGIN_MS;
    await expect
      .poll(() => Date.now() - since!, {
        message: `quick-login window (${gap} ms) since the last failure`,
        intervals: [50],
        timeout: gap + 5_000,
      })
      .toBeGreaterThanOrEqual(gap);
  }
}
