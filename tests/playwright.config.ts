import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: [
    ['html'],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],
  use: {
    baseURL: 'http://localhost:5173/PruebaMapJapan/',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
      },
      testIgnore: ['**/passkeys.spec.ts'],
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
      },
      // idp-config: static file checks, browser-independent; run once (chromium).
      testIgnore: ['**/passkeys.spec.ts', '**/idp-config.spec.ts'],
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
      },
      testIgnore: ['**/passkeys.spec.ts', '**/idp-config.spec.ts'],
    },
    {
      name: 'chromium-passkeys',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/passkeys.spec.ts'],
      fullyParallel: false,
    },
  ],
  // CI serves the production build via `vite preview`. Letting Playwright own the server
  // guarantees it is listening before the first test (a backgrounded shell step raced the
  // test run) and is torn down afterwards. Locally, dev servers are started by hand.
  // PW_NO_WEBSERVER=1: specs that never load the app (keycloak-flow.yml drives Keycloak
  // directly) skip the frontend build and preview server.
  webServer: process.env.CI && !process.env.PW_NO_WEBSERVER
    ? {
        command: 'npm run preview:frontend',
        cwd: '..',
        url: 'http://localhost:5173/PruebaMapJapan/',
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
  globalSetup: './global-setup.ts',
});
