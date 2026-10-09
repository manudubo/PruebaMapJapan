import { test, expect } from '@playwright/test';
import { audit, lines, PHONE_WIDTHS, LANDSCAPE, TABLETS, phoneViewport, type Offender } from './fixtures/mobile';
import { SCREENS } from './fixtures/mobileScreens';
import { mockKeycloakLoggedIn } from './fixtures/mockKeycloak';
import { stubMapThirdParty } from './fixtures/mockThirdParty';
import { mockTripStore } from './fixtures/mockTripStore';
import { mobileTrip } from './fixtures/mobileScreens';

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
  { label: 'landscape 844x390', width: 844, height: 390 },
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

/**
 * Owner review items from the mobile QA round: the landscape editor spends too much of a ~375px
 * screen on chrome, and the profile heading sat flush against its card.
 */
const LANDSCAPES = [{ width: 667, height: 375 }, { width: 844, height: 390 }];
const SCREEN = (name: string) => SCREENS.find((s) => s.name === name)!;

for (const vp of LANDSCAPES) {
  test(`editor in landscape ${vp.width}x${vp.height}: chrome is compact, save status stays readable`, async ({ page }) => {
    await page.setViewportSize(vp);
    await SCREEN('editor-city').open(page);
    // Nav scrolls away instead of pinning 56px of a 375px screen; the content starts high up.
    const top = await page.locator('#te-view').evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    expect(top, 'plan content starts within the top ~55% of the screen').toBeLessThan(vp.height * 0.55);
    const navPos = await page.locator('travel-nav').evaluate((e) => getComputedStyle(e.shadowRoot!.querySelector('nav')!).position);
    expect(navPos).toBe('static');
    // Save status is visible and not clipped.
    const st = page.locator('#save-status');
    await expect(st).toBeVisible();
    const box = (await st.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    // Controls keep their 44px targets and nothing scrolls sideways.
    const r = await audit(page);
    expect(r.hscroll).toBeNull();
    expect(lines(r.smallTargets)).toEqual([]);
    // The map is tall enough to use.
    await page.locator('#te-tab-preview').click();
    const mapH = await page.locator('#map').evaluate((e) => e.getBoundingClientRect().height);
    expect(mapH).toBeGreaterThanOrEqual(220);
  });
}

for (const width of [320, 360, 430, 1024]) {
  test(`profile at ${width}px: heading and sections are inset from the card edge`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1024 ? 768 : 800 });
    await SCREEN('profile').open(page);
    const gap = await page.evaluate(() => {
      const card = document.querySelector('.page-card')!.getBoundingClientRect();
      const h1 = document.getElementById('profile-name')!.getBoundingClientRect();
      const sec = document.querySelector('.profile-section')!.getBoundingClientRect();
      const list = document.querySelector('#passkey-list')!.getBoundingClientRect();
      return { h1: h1.left - card.left, sec: sec.left - card.left, secRight: card.right - sec.right, list: list.left - card.left, listRight: card.right - list.right };
    });
    expect(gap.h1).toBeGreaterThanOrEqual(16);
    expect(gap.sec).toBeGreaterThanOrEqual(16);
    expect(gap.secRight).toBeGreaterThanOrEqual(16);
    expect(gap.list).toBeGreaterThan(gap.h1);
    expect(gap.listRight).toBeGreaterThan(0);
    const r = await audit(page);
    expect(r.hscroll).toBeNull();
    expect(lines(r.smallTargets)).toEqual([]);
  });
}

test('profile: the delete-passkey dialog fits a 320px phone and keeps 44px buttons', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await SCREEN('profile').open(page);
  await page.locator('#passkey-list button').first().tap();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  for (const id of ['#passkey-delete-cancel', '#passkey-delete-confirm']) {
    expect((await page.locator(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('editor drop-a-pin hint uses touch wording and a 44px Cancel button', async ({ page }) => {
  await mockKeycloakLoggedIn(page);
  await stubMapThirdParty(page);
  await mockTripStore(page, { trips: [mobileTrip()] });
  await page.goto('trip-edit.html?tripId=1#city/11');
  await expect(page.locator('#pick-pin')).toBeVisible();
  await page.locator('#pick-pin').tap();
  await expect(page.locator('#te-pick-banner-text')).toHaveText('Tap the map to drop the pin. Tap Cancel to stop.');
  const cancel = page.locator('#te-pick-cancel');
  await expect(cancel).toBeVisible();
  expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await cancel.tap();
  await expect(page.locator('#te-pick-banner')).toBeHidden();
});
