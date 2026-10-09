import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { mockAccountCredentials, mockAuthFlows, WEBAUTHN_SUPPORTED } from './fixtures/mockAuthFlows';
import { audit, lines, phoneViewport, LANDSCAPE } from './fixtures/mobile';
import { SCREENS, openEditorAt } from './fixtures/mobileScreens';

/**
 * MOBILE-COVERAGE.md, "platform" columns: document-level contracts phones depend on (viewport
 * meta, manifest, dvh, safe areas), dialogs and the one-time-code field on small screens, reduced
 * motion, enlarged text and offline behaviour.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test mobile-platform --project=mobile
 */

test.use({ storageState: { cookies: [], origins: [] } });

const HTML_PAGES = [
  'index', 'dashboard', 'profile', 'recover', 'trip', 'trip-edit',
  'tokyo', 'nagoya', 'takayama', 'kyoto', 'osaka', 'naoshima', 'hakone', 'tokyo2',
];

test.describe('document contracts', () => {
  for (const name of HTML_PAGES) {
    test(`${name}.html: responsive viewport that never blocks pinch-zoom`, async ({ request }) => {
      const html = await (await request.get(`${name}.html`)).text();
      const meta = /<meta[^>]+name="viewport"[^>]*>/i.exec(html)?.[0] ?? '';
      expect(meta, 'viewport meta present').toContain('width=device-width');
      expect(meta).toContain('initial-scale=1');
      expect(meta).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
      expect(meta).not.toMatch(/maximum-scale\s*=\s*[0-4](\.\d+)?\b/i);
    });
  }

  test('manifest: installable standalone app that does not lock the orientation', async ({ request }) => {
    const m = (await (await request.get('manifest.json')).json()) as Record<string, unknown> & { icons: Array<{ sizes: string; purpose?: string }> };
    expect(m['display']).toBe('standalone');
    // A portrait lock makes the landscape map unusable for anyone who rotates the phone (WCAG 1.3.4).
    expect(m['orientation']).toBeUndefined();
    expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some((i) => i.sizes === '512x512')).toBe(true);
    expect(m['start_url']).toBeTruthy();
  });

  test('stylesheets use dynamic viewport units and the safe-area inset where content is fixed to a screen edge', async ({ page }) => {
    await mockKeycloakLoggedOut(page);
    await page.goto('index.html');
    const css = await page.evaluate(async () => {
      const out: string[] = [];
      for (const s of Array.from(document.styleSheets)) {
        try { out.push(Array.from(s.cssRules).map((r) => r.cssText).join('\n')); } catch { /* cross-origin */ }
      }
      return out.join('\n');
    });
    expect(css).toMatch(/min-height:\s*calc\([^)]*100dvh/); // landing hero (Chromium may reorder the calc terms)
    expect(css).toMatch(/min-height:\s*100dvh/); // body
  });

  test('the editor clears the home indicator (safe-area-inset-bottom) with its undo snackbar', async ({ page }) => {
    await openEditorAt(page, '#route');
    const sheets = await page.evaluate(() => Array.from(document.styleSheets).map((sh) => {
      try { return Array.from(sh.cssRules).map((r) => r.cssText).join('\n'); } catch { return ''; }
    }));
    expect(sheets.join('\n')).toContain('safe-area-inset-bottom'); // undo snackbar clears the home indicator
  });
});

test.describe('dialogs and forms on a phone', () => {
  const sizes = [
    { label: '360px', ...phoneViewport(360) },
    { label: 'landscape', ...LANDSCAPE },
  ];

  async function signedIn(page: Page, opts: { asNew?: boolean; verified?: boolean } = {}) {
    const verification = { verified: opts.verified ?? true };
    await page.addInitScript(WEBAUTHN_SUPPORTED);
    await mockKeycloakLoggedIn(page);
    await mockAccountCredentials(page, { passkeys: 0, passwords: 1 });
    await mockApi(page, { trips: [], verification, me: { onboarding: { is_new: opts.asNew ?? false } } });
    await mockAuthFlows(page, { code: '123456', verification });
  }

  for (const size of sizes) {
    test(`passkey invitation dialog fits ${size.label}: scrollable, reachable buttons of 44px`, async ({ page }) => {
      await page.setViewportSize(size);
      await signedIn(page, { asNew: true });
      await page.goto('dashboard.html');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      for (const name of ['Create a passkey', 'Not now', "Don't ask again"]) {
        const b = dialog.getByRole('button', { name });
        await b.scrollIntoViewIfNeeded();
        await expect(b).toBeInViewport();
        expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await dialog.getByRole('button', { name: 'Not now' }).tap();
      await expect(dialog).toBeHidden();
    });
  }

  test('email verification: one-time-code autofill, numeric keypad, 44px digits and resend, no zoom-on-focus', async ({ page }) => {
    await page.setViewportSize(phoneViewport(360));
    await signedIn(page, { verified: false });
    await page.goto('dashboard.html');
    const digits = page.locator('.code-input-digit');
    await expect(digits).toHaveCount(6);
    await expect(digits.first()).toHaveAttribute('autocomplete', 'one-time-code');
    for (let i = 0; i < 6; i++) {
      await expect(digits.nth(i)).toHaveAttribute('inputmode', 'numeric');
      const box = (await digits.nth(i).boundingBox())!;
      expect(box.width, `digit ${i + 1} width`).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await digits.nth(i).evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
    const r = await audit(page);
    expect(r.hscroll).toBeNull();
    expect(lines(r.smallInputs)).toEqual([]);
    const resend = page.locator('#verify-email-resend');
    await expect(resend).toBeVisible();
    expect((await resend.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // What iOS does on an SMS code: it inserts the whole code into the focused first box.
    await digits.first().tap();
    const confirm = page.waitForRequest((r) => r.url().includes('/auth/email-verify/confirm'));
    await page.keyboard.insertText('123456');
    // The six boxes fill from the one insertion and the complete code is submitted by itself.
    expect(JSON.parse((await confirm).postData() ?? '{}')).toMatchObject({ code: '123456' });
  });
});

test.describe('motion, contrast and text size', () => {
  for (const name of ['landing', 'dashboard', 'trip-overview', 'editor-city'] as const) {
    test(`${name}: reduced motion leaves no infinite animation running`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await SCREENS.find((s) => s.name === name)!.open(page);
      const infinite = await page.evaluate(() => document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming();
        return a.playState === 'running' && t && t.iterations === Infinity;
      }).length);
      expect(infinite).toBe(0);
    });
  }

  for (const name of ['dashboard', 'trip-overview', 'editor-route', 'editor-city', 'profile'] as const) {
    test(`${name}: dark mode keeps the layout inside the viewport`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await SCREENS.find((s) => s.name === name)!.open(page);
      for (const w of [320, 390, 430]) {
        await page.setViewportSize(phoneViewport(w));
        const r = await audit(page);
        expect(r.hscroll, `${w}px`).toBeNull();
        expect(lines(r.clipped), `${w}px`).toEqual([]);
      }
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgb(245, 245, 247)');
    });
  }

  for (const name of ['dashboard', 'trip-overview', 'editor-route', 'editor-city', 'profile', 'recover'] as const) {
    test(`${name}: text enlarged by 50% (large dynamic type) still fits 360px without sideways scroll`, async ({ page }) => {
      await page.setViewportSize(phoneViewport(360));
      await SCREENS.find((s) => s.name === name)!.open(page);
      // Scale every font once from its computed size (Safari's "Larger text" scales px sizes too).
      await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll<HTMLElement>('body *'));
        const sizes = all.map((e) => parseFloat(getComputedStyle(e).fontSize));
        all.forEach((e, i) => e.style.setProperty('font-size', `${sizes[i]! * 1.5}px`, 'important'));
      });
      const r = await audit(page, { targets: false });
      expect(r.hscroll).toBeNull();
      expect(lines(r.clipped)).toEqual([]);
    });
  }
});

test.describe('offline', () => {
  test('after one visit the installed app shows a city page with no network', async ({ page, context }) => {
    await page.route(/:8080\//, (r) => r.abort());
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    const sw = await (await page.request.get('sw.js')).text();
    const prod = !sw.includes('__BUILD_VERSION__');
    test.fixme(!prod && !process.env.CI, 'needs a production build (npm run build && npm run preview)');
    expect(prod, 'sw.js must be the built service worker').toBe(true);

    await page.goto('tokyo.html');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
      }
    });
    await page.reload(); // second load is served under the worker's control and fills its caches
    await expect(page.locator('h1')).toBeVisible();

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('travel-nav')).toBeAttached();
  });
});
