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
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['**/passkeys.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['**/passkeys.spec.ts'],
    },
    {
      name: 'chromium-passkeys',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/passkeys.spec.ts'],
    },
  ],
  globalSetup: './global-setup.ts',
});
