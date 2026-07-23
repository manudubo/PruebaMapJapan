import { chromium, FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { clearRequiredActions } from './e2e/fixtures/kc-admin';
import { loginViaKcForm } from './e2e/fixtures/kc-login-helper';

dotenv.config({ path: path.join(__dirname, '.env.test') });

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8787';
const MAX_RETRIES = 30;
const RETRY_INTERVAL_MS = 1000;

const AUTH_DIR = path.join(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'user.json');
const SESSION_STORAGE_PATH = path.join(AUTH_DIR, 'session.json');
const MAX_AGE_MS = 20 * 60 * 1000; // 20 min — KC idle timeout is 30 min; stay well under it
const NEW_USER_STORAGE_STATE_PATH = path.join(AUTH_DIR, 'new-user.json');
const NEW_USER_SESSION_STORAGE_PATH = path.join(AUTH_DIR, 'new-user-session.json');

async function waitForServer(url: string, name: string): Promise<void> {
  console.log(`Waiting for ${name} at ${url}...`);
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok || response.status < 500) {
        console.log(`${name} is ready (status ${response.status})`);
        return;
      }
    } catch {
      // Server not yet responding
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  throw new Error(`${name} did not become ready at ${url} after ${MAX_RETRIES} attempts`);
}

function isStorageStateFresh(): boolean {
  if (!fs.existsSync(STORAGE_STATE_PATH)) return false;
  const age = Date.now() - fs.statSync(STORAGE_STATE_PATH).mtimeMs;
  return age < MAX_AGE_MS;
}

function isNewUserStorageStateFresh(): boolean {
  if (!fs.existsSync(NEW_USER_STORAGE_STATE_PATH)) return false;
  const age = Date.now() - fs.statSync(NEW_USER_STORAGE_STATE_PATH).mtimeMs;
  return age < MAX_AGE_MS;
}

async function kcLogin(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await loginViaKcForm(page, process.env.E2E_TEST_USERNAME!, process.env.E2E_TEST_PASSWORD!);

  // Reload once to flush KC auth-flow cookies (AUTH_SESSION_ID, KC_AUTH_SESSION_HASH)
  // before saving state — replaying those cookies causes KC to resume the old flow.
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));

  // Capture cookies + localStorage (storageState)
  await context.storageState({ path: STORAGE_STATE_PATH });

  // Capture sessionStorage — keycloak-js stores tokens here (Playwright bug #31108)
  const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
  fs.writeFileSync(SESSION_STORAGE_PATH, JSON.stringify(sessionEntries), 'utf-8');

  await browser.close();
}

async function kcLoginNewUser(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await loginViaKcForm(page, process.env.E2E_NEW_USER_USERNAME!, process.env.E2E_NEW_USER_PASSWORD!);

  // Reload once to flush KC auth-flow cookies before saving state
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));

  await context.storageState({ path: NEW_USER_STORAGE_STATE_PATH });

  const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
  fs.writeFileSync(NEW_USER_SESSION_STORAGE_PATH, JSON.stringify(sessionEntries), 'utf-8');

  await browser.close();
}

async function kcLoginSessionUser(): Promise<void> {
  const username = process.env.E2E_SESSION_USERNAME ?? 'session-test@local';
  const password = process.env.E2E_SESSION_PASSWORD ?? '';

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // The webauthn-authenticator-passwordless KC execution adds the
  // webauthn-register-passwordless required action for users with no passkeys.
  // On the very first login for this user, Keycloak.js triggers the required-action
  // AFTER the initial redirect to the app (Case B) instead of during the KC auth flow
  // (Case A). loginViaKcForm handles Case A but not Case B. Pre-handle Case B here
  // so all 21 session-management tests see only Case A, which loginViaKcForm already
  // covers with its hitRequiredAction race.
  await loginViaKcForm(page, username, password);

  // loginViaKcForm returns once the page reaches localhost:5173. Check whether
  // Keycloak.js is about to redirect back to the required-action page (Case B).
  const caseB = await page
    .waitForURL(/required-action/, { timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (caseB) {
    console.log('session-test@local: handling Case B webauthn-register-passwordless redirect');
    await page.waitForLoadState('networkidle').catch(() => page.waitForLoadState('load'));
    const skipBtn = page.locator('a, button').filter({ hasText: /maybe later|skip|not now|later|cancel/i });
    if (await skipBtn.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)) {
      await skipBtn.first().click();
    }
    await page.waitForURL(/localhost:5173/, { timeout: 20_000 });
  }

  await browser.close();

  // Remove any remaining required actions so the user enters each test run clean.
  await clearRequiredActions(username);
}

async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  // Only wait for servers when they are actually being started by the test runner.
  // In CI the servers are started before npx playwright test runs.
  // Locally tests can mock everything via page.route() so servers are optional.
  const shouldWaitForFrontend = process.env.WAIT_FOR_FRONTEND === 'true';
  const shouldWaitForBackend = process.env.WAIT_FOR_BACKEND === 'true';

  if (shouldWaitForFrontend) {
    await waitForServer(FRONTEND_URL, 'Frontend dev server');
  }

  if (shouldWaitForBackend) {
    await waitForServer(`${BACKEND_URL}/api/health`, 'Backend dev server');
  }

  // OIDC login — skipped entirely when SKIP_REAL_AUTH is set (D-03)
  if (!process.env.SKIP_REAL_AUTH) {
    if (!isStorageStateFresh()) {
      await kcLogin();
    } else {
      console.log('Reusing fresh storageState from .auth/user.json');
    }
    if (!isNewUserStorageStateFresh()) {
      await kcLoginNewUser();
    } else {
      console.log('Reusing fresh storageState from .auth/new-user.json');
    }
    // Pre-handle the first-ever login for session-test@local (Case B required-action).
    // This ensures session-management.spec.ts tests see only Case A behaviour, which
    // loginViaKcForm already handles via its hitRequiredAction race.
    await kcLoginSessionUser();
  }

  // Return teardown function
  return async () => {
    // Nothing to clean up — servers were started externally
    console.log('Global teardown complete');
  };
}

export default globalSetup;
