import { Page } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

/** Drive the KC browser login form. Ends when the app URL is restored. Callers own post-login state. */
export async function loginViaKcForm(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${FRONTEND_URL}/PruebaMapJapan/dashboard.html`);

  const loginPromptBtn = page.locator('#auth-login-prompt-btn');
  if (await loginPromptBtn.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await loginPromptBtn.click();
  }

  await page.waitForURL(/localhost:8080/, { timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));

  const tryAnotherWay = page.locator('a, button').filter({ hasText: /try another way/i });
  if (await tryAnotherWay.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
    await tryAnotherWay.first().click();
    await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));
    const passwordOpt = page.locator('a, button').filter({ hasText: /username and password|^password$/i });
    if (await passwordOpt.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await passwordOpt.first().click();
      await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));
    }
  }

  const usernameField = page.locator('#username, input[name="username"], input[autocomplete="username"]');
  await usernameField.first().waitFor({ state: 'visible', timeout: 10_000 });
  await usernameField.first().fill(username);

  const passwordField = page.locator('input[name="password"], #password');
  if (!(await passwordField.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await page.getByRole('button', { name: /sign in/i }).click();
    await passwordField.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await passwordField.fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // KC may insert a required-action page (e.g. webauthn-register-passwordless) between
  // credential submission and the final app redirect. Race the two possible outcomes so
  // neither side blocks if the other fires first.
  const hitRequiredAction = await Promise.race([
    page.waitForURL(/localhost:5173/, { timeout: 20_000 }).then(() => false),
    page.waitForURL(/required-action/, { timeout: 20_000 }).then(() => true),
  ]);

  if (hitRequiredAction) {
    const skipBtn = page.locator('a, button').filter({ hasText: /maybe later|skip|not now|later|cancel/i });
    if (await skipBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await skipBtn.first().click();
    }
    await page.waitForURL(/localhost:5173/, { timeout: 20_000 });
  }
}
