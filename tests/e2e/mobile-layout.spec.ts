import { test, expect } from '@playwright/test';
import { audit, lines, PHONE_WIDTHS, LANDSCAPE, TABLETS, phoneViewport, type Offender } from './fixtures/mobile';
import { SCREENS } from './fixtures/mobileScreens';

/**
 * MOBILE-COVERAGE.md, "layout" columns: every screen, at every phone width, in landscape and on
 * tablets, must (1) not scroll sideways, (2) keep every control inside the viewport, (3) give every
 * control a 44x44 target and (4) keep text fields at >= 16px so iOS does not zoom on focus.
 *
 * Runs in the `mobile` / `mobile-android` projects (touch + mobile UA). The page is opened once
 * and resized through the matrix, which also exercises the live reflow (rotate / split-screen).
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test mobile-layout --project=mobile
 */

test.use({ storageState: { cookies: [], origins: [] } });

const VIEWPORTS = [
  ...PHONE_WIDTHS.map((w) => ({ label: `${w}px`, ...phoneViewport(w) })),
  { label: 'landscape 667x375', ...LANDSCAPE },
  ...TABLETS.map((w) => ({ label: `tablet ${w}px`, width: w, height: w === 768 ? 1024 : 768 })),
];

for (const screen of SCREENS) {
  test(`${screen.name}: no sideways scroll, nothing clipped, 44px targets, 16px inputs at every width`, async ({ page }) => {
    await screen.open(page);

    const scroll: string[] = [];
    const clipped: string[] = [];
    const small: string[] = [];
    const inputs: string[] = [];
    const seen = (acc: string[], label: string, o: Offender[]) => {
      for (const l of lines(o)) if (!acc.some((a) => a.endsWith(` ${l}`))) acc.push(`[${label}] ${l}`);
    };

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Each viewport has been applied once layout has settled at that width.
      await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(vp.width);
      // Two frames: Leaflet re-measures its container on the resize event, then repositions markers.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(0)))));
      const r = await audit(page);
      if (r.hscroll) scroll.push(`[${vp.label}] scrollWidth ${r.hscroll.scrollWidth} > ${r.hscroll.clientWidth}`);
      seen(clipped, vp.label, r.clipped);
      seen(small, vp.label, r.smallTargets);
      seen(inputs, vp.label, r.smallInputs);
    }

    expect.soft(scroll, 'horizontal page scroll').toEqual([]);
    expect.soft(clipped, 'controls outside the viewport').toEqual([]);
    expect.soft(inputs, 'text fields under 16px (iOS zooms on focus)').toEqual([]);
    expect.soft(small, 'tap targets under 44x44').toEqual([]);
  });
}
