import { test } from '@playwright/test';
import { SCREENS } from './fixtures/mobileScreens';
import { phoneViewport, LANDSCAPE } from './fixtures/mobile';

/**
 * Screenshot generator for docs/design/mobile-screens (visual review of every journey, light and
 * dark, at 360 / 390 / 430 px and landscape). Not an assertion suite: it only runs when asked,
 *
 *   MOBILE_SCREENSHOTS=/abs/output/dir npx playwright test mobile-screens --project=mobile
 *
 * so CI does not pay for ~100 full-page PNGs.
 */

const OUT = process.env.MOBILE_SCREENSHOTS;

test.use({ storageState: { cookies: [], origins: [] }, deviceScaleFactor: 1 });

for (const scheme of ['light', 'dark'] as const) {
  for (const screen of SCREENS) {
    test(`${screen.name} ${scheme}`, async ({ page }) => {
      test.fixme(!OUT, 'set MOBILE_SCREENSHOTS=<dir> to generate the review screenshots');
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize(phoneViewport(390));
      await screen.open(page);
      for (const w of [360, 390, 430]) {
        await page.setViewportSize(phoneViewport(w));
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // fullPage would make Chromium re-apply device metrics and drop `pointer: coarse`, so the
        // shot would show the desktop UI. A tall viewport keeps the real touch emulation.
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: w, height: Math.min(Math.max(height, 700), 3200) });
        await page.screenshot({ path: `${OUT}/${screen.name}-${w}-${scheme}.png` });
      }
      if (screen.area === 'editor' || screen.name.startsWith('city-') || screen.name.startsWith('trip-')) {
        await page.setViewportSize(LANDSCAPE);
        await page.screenshot({ path: `${OUT}/${screen.name}-landscape-${scheme}.png` });
      }
    });
  }
}
