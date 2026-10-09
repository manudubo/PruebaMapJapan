import { devices, expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { contrastOf, layoutProblems, TEXT_SELECTORS } from './fixtures/idp-theme/mobile-checks';
import { openSnapshot, SCREENS } from './fixtures/idp-theme/snapshot-server';

/**
 * Keycloak login theme on a phone, light and dark: real Keycloak 26.6.1 HTML of every screen
 * (fixtures/idp-theme/*.html, regenerated with capture.mjs from a Keycloak served under /auth like
 * production) with the theme's real resources. iPhone 13 (390px, 3x, touch), a 320px iPhone SE-class
 * width and Pixel 7. The audit (fixtures/idp-theme/mobile-checks.ts) fails on what the owner saw on
 * a real iPhone: sideways scroll, anything past the right edge, boxes inside boxes, big nested
 * indents, controls under 44px, input text under 16px, an oversized title, low contrast.
 *
 * Engine: Chromium with the device descriptors (no WebKit build is installed here; set
 * MOBILE_ENGINE=webkit on a machine that has it to run the same checks on WebKit).
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-theme-mobile --project=chromium
 *   QA_SCREENSHOTS_DIR=<dir> also saves a full-page PNG of every state.
 */
const SHOTS = process.env['QA_SCREENSHOTS_DIR'];
const strip = ({ defaultBrowserType: _d, ...rest }: (typeof devices)[string]) => rest;
const VIEWPORTS = {
  'iphone-390': { ...strip(devices['iPhone 13']), viewport: { width: 390, height: 844 } },
  'iphone-320': { ...strip(devices['iPhone 13']), viewport: { width: 320, height: 568 } },
  'pixel-7': strip(devices['Pixel 7']),
} as const;

for (const [vpName, descriptor] of Object.entries(VIEWPORTS)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`theme on a phone: ${vpName}, ${scheme}`, () => {
      test.use({ ...descriptor, colorScheme: scheme, storageState: { cookies: [], origins: [] } });

      for (const screen of SCREENS) {
        test(`${screen}: one flat responsive card`, async ({ page }) => {
          await openSnapshot(page, screen);
          expect(await layoutProblems(page)).toEqual([]);
          for (const selector of TEXT_SELECTORS) {
            for (const { ratio } of await contrastOf(page, selector)) expect(ratio, `${selector} contrast`).toBeGreaterThanOrEqual(4.5);
          }
          if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: path.join(SHOTS, `${screen}-${scheme}-${vpName}.png`), fullPage: true });
          }
        });
      }
    });
  }
}
