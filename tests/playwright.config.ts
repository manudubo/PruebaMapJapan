import { defineConfig, devices } from '@playwright/test';

// Phone specs (mobile-*.spec.ts) run only in the `mobile*` projects below: they set their own
// viewports and assume touch input, so running them on the desktop projects would be meaningless.
const MOBILE_SPECS = '**/mobile-*.spec.ts';

// Engine for the iPhone project. The device descriptor (viewport, DPR, touch, user agent) is the
// iPhone 13's either way; only the engine differs. CI installs chromium only, so the default is
// chromium; run `MOBILE_ENGINE=webkit npx playwright test --project=mobile` on a machine with
// `npx playwright install webkit` for the closest thing to iOS Safari that runs off-device.
const MOBILE_ENGINE = process.env.MOBILE_ENGINE === 'webkit' ? 'webkit' : 'chromium';

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
      testIgnore: ['**/passkeys.spec.ts', MOBILE_SPECS],
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
      },
      // idp-config: static file checks; idp-hardening: mostly raw HTTP against Keycloak.
      // Both are browser-independent, so they run once (chromium).
      testIgnore: ['**/passkeys.spec.ts', '**/idp-config.spec.ts', '**/idp-hardening.spec.ts', MOBILE_SPECS],
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        ...(process.env.SKIP_REAL_AUTH ? {} : { storageState: '.auth/user.json' }),
      },
      testIgnore: ['**/passkeys.spec.ts', '**/idp-config.spec.ts', '**/idp-hardening.spec.ts', MOBILE_SPECS],
    },
    {
      // iPhone 13 (390x664 @3x, touch, mobile UA) - see MOBILE_ENGINE for the engine actually used.
      name: 'mobile',
      testMatch: [MOBILE_SPECS],
      use: { ...devices['iPhone 13'], defaultBrowserType: MOBILE_ENGINE, browserName: MOBILE_ENGINE },
    },
    {
      // Pixel 7 on Chromium: the native Android Chrome engine (touch, 412x839 @2.6x, mobile UA).
      name: 'mobile-android',
      testMatch: [MOBILE_SPECS],
      use: { ...devices['Pixel 7'] },
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
