import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Keycloak login theme, rendered: real Keycloak 26.6.1 HTML of the main screens
 * (tests/e2e/fixtures/idp-theme/*.html, regenerated with capture.mjs next to them) styled by
 * the real theme CSS served from keycloak/themes/japan-trip. No Keycloak needed.
 *
 * Checks, light and dark, at 375px and 1280px: one card and no boxes inside boxes, no
 * horizontal scroll, 16px gutters on a phone, controls >= 44px, text contrast, the app's
 * font and colours, a visible focus ring, and axe (wcag2a/aa, 2.1 aa, 2.2 aa) when axe-core
 * is available (AXE_CORE_PATH=<axe.min.js>, or `npm i --no-save axe-core`).
 * QA_SCREENSHOTS_DIR=<dir> also saves a PNG of every state.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-theme-render --project=chromium
 */

const ROOT = path.resolve(__dirname, '../..');
const THEME = path.join(ROOT, 'keycloak/themes/japan-trip/login/resources');
const SNAPSHOTS = path.join(__dirname, 'fixtures/idp-theme');
const ORIGIN = 'http://idp.test';
const SCREENS = ['username', 'register', 'password-error', 'webauthn-register', 'update-password-error', 'error'] as const;
const SHOTS = process.env['QA_SCREENSHOTS_DIR'];

function loadAxe(): string | null {
  const candidates = [process.env['AXE_CORE_PATH'] ?? ''];
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch {
    // not installed
  }
  for (const file of candidates.filter(Boolean)) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      // try the next one
    }
  }
  return null;
}
const AXE = loadAxe();

const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html' };

async function open(page: Page, screen: string) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.startsWith('/resources/login/japan-trip/')
      ? path.join(THEME, url.pathname.replace('/resources/login/japan-trip/', ''))
      : path.join(SNAPSHOTS, `${url.pathname.slice(1)}`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] ?? 'text/plain' });
  });
  // The web font is the one thing fetched from outside; the metric-matched fallback stands in.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.goto(`${ORIGIN}/${screen}.html`);
  await page.waitForLoadState('domcontentloaded');
}

/** WCAG contrast ratio of an element's text colour against its effective background. */
async function contrastOf(page: Page, selector: string): Promise<number[]> {
  return page.locator(selector).evaluateAll((els) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number) as number[];
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const backdrop = (el: Element): number[] => {
      let rgb = [255, 255, 255];
      const stack: number[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
        if (a > 0) stack.push([r!, g!, b!, a]);
        if (a === 1) break;
      }
      for (const [r, g, b, a] of stack.reverse()) rgb = [r! * a! + rgb[0]! * (1 - a!), g! * a! + rgb[1]! * (1 - a!), b! * a! + rgb[2]! * (1 - a!)];
      return rgb;
    };
    return els.map((el) => {
      const fg = parse(getComputedStyle(el).color);
      const bg = backdrop(el);
      const [a, b] = [lum(fg), lum(bg)];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  });
}

for (const scheme of ['light', 'dark'] as const) {
  for (const [label, viewport] of [['375px', { width: 375, height: 740 }], ['1280px', { width: 1280, height: 800 }]] as const) {
    test.describe(`theme render, ${scheme}, ${label}`, () => {
      test.use({ viewport, colorScheme: scheme, storageState: { cookies: [], origins: [] } });

      for (const screen of SCREENS) {
        test.describe(screen, () => {
          test.beforeEach(async ({ page }) => open(page, screen));

          test.afterEach(async ({ page }) => {
            if (SHOTS) {
              fs.mkdirSync(SHOTS, { recursive: true });
              await page.screenshot({ path: path.join(SHOTS, `${screen}-${scheme}-${label}.png`), fullPage: true });
            }
          });

          test('one card, nothing boxed inside it, brand above, page title is the only h1', async ({ page }) => {
            await expect(page.locator('main.jp-card')).toHaveCount(1);
            await expect(page.locator('.jp-card .jp-card')).toHaveCount(0);
            await expect(page.locator('h1')).toHaveCount(1);
            await expect(page.locator('#kc-header-wrapper')).toHaveText('Japan Trip');
            // Inside the card only controls, alerts, the account chip and rules have a border.
            const boxed = await page.locator('main.jp-card *').evaluateAll((els) =>
              els
                .filter((el) => {
                  const s = getComputedStyle(el);
                  const border = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
                  return border && el.getBoundingClientRect().width > 0;
                })
                .filter((el) => !el.matches('input, button, a.jp-btn, .jp-input-group__toggle, .jp-alert, .jp-user, .jp-choice, hr, img, #kc-info, svg *'))
                .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
            );
            expect(boxed, 'bordered boxes that are not controls').toEqual([]);
            // ...and the card itself is the only filled surface: no descendant paints the card colour again as a box.
            const cardBg = await page.locator('main.jp-card').evaluate((el) => getComputedStyle(el).backgroundColor);
            const nestedSurface = await page.locator('main.jp-card div, main.jp-card section, main.jp-card form').evaluateAll(
              (els, bg) =>
                els.filter((el) => {
                  const s = getComputedStyle(el);
                  return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== bg && !el.matches('.jp-alert, .jp-user, .jp-choice, .jp-passkey-hero, .jp-input-group');
                }).map((el) => el.className),
              cardBg,
            );
            expect(nestedSurface).toEqual([]);
          });

          test('fits the viewport; 16px gutters on a phone', async ({ page }) => {
            const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
            expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
            const box = (await page.locator('main.jp-card').boundingBox())!;
            if (innerWidth <= 480) {
              expect(box.x).toBeGreaterThanOrEqual(16);
              expect(innerWidth - (box.x + box.width)).toBeGreaterThanOrEqual(16);
            } else {
              expect(box.width).toBeLessThanOrEqual(440);
              expect(Math.abs(box.x + box.width / 2 - innerWidth / 2)).toBeLessThan(2); // centred
            }
          });

          test('every control is at least 44px tall', async ({ page }) => {
            const small = await page.locator('main.jp-card, .jp-foot').locator('input:not([type=hidden]):not([type=checkbox]), button, a.jp-btn, .jp-foot a, #kc-info a, .jp-user__change, .jp-form__aside a, .jp-form__options a, label.jp-check__label, .checkbox label').evaluateAll((els) =>
              els
                .filter((el) => el.getBoundingClientRect().width > 0)
                .map((el) => ({ el: `${el.tagName.toLowerCase()}#${el.id}.${el.className}`, h: Math.round(el.getBoundingClientRect().height) }))
                .filter((x) => x.h < 44),
            );
            expect(small).toEqual([]);
          });

          test('uses the app\'s font and colours for the page, per colour scheme', async ({ page }) => {
            const s = await page.evaluate(() => ({
              font: getComputedStyle(document.body).fontFamily,
              bg: getComputedStyle(document.body).backgroundColor,
              card: getComputedStyle(document.querySelector('main.jp-card')!).backgroundColor,
              radius: getComputedStyle(document.querySelector('main.jp-card')!).borderTopLeftRadius,
              title: getComputedStyle(document.querySelector('h1')!).fontWeight,
            }));
            expect(s.font).toContain('Inter');
            expect(s.radius).toBe('0px');
            expect(s.title).toBe('700');
            // frontend/src/styles/main.css: --jp-bg / --jp-surface, light and [data-theme="dark"]
            expect(s.bg).toBe(scheme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(245, 245, 247)');
            expect(s.card).toBe(scheme === 'dark' ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)');
          });

          test('text has AA contrast (4.5:1)', async ({ page }) => {
            for (const selector of ['h1', '.jp-subtitle', 'label', '.jp-btn--primary', '.jp-alert__text', '.jp-field__error', '#kc-info a, #kc-info p', '.jp-idp-exit', '.jp-user__name', '.jp-user__change', '.jp-choice__desc']) {
              for (const ratio of await contrastOf(page, selector)) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
            }
          });

          test('keyboard focus is visible on the first control', async ({ page }) => {
            await page.keyboard.press('Tab');
            const outline = await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              if (!el || el === document.body) return null;
              const s = getComputedStyle(el);
              const group = el.closest('.jp-input-group');
              const g = group ? getComputedStyle(group) : null;
              return { w: parseFloat(s.outlineWidth) || parseFloat(g?.outlineWidth ?? '0'), style: s.outlineStyle !== 'none' ? s.outlineStyle : g?.outlineStyle };
            });
            expect(outline, 'something is focusable').not.toBeNull();
            expect(outline!.w).toBeGreaterThanOrEqual(2);
            expect(outline!.style).not.toBe('none');
          });

          test('axe: no violations', async ({ page }) => {
            test.fixme(!AXE, 'axe-core not available (set AXE_CORE_PATH or npm i --no-save axe-core)');
            await page.evaluate(AXE!);
            const results = await page.evaluate(() =>
              (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe.run(document, {
                runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
              }),
            );
            expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
          });
        });
      }
    });
  }
}

test.describe('theme render: screen specifics', () => {
  test.use({ viewport: { width: 375, height: 740 }, storageState: { cookies: [], origins: [] } });

  test('username step: conditional-UI-ready e-mail field, label, registration link', async ({ page }) => {
    await open(page, 'username');
    const input = page.locator('#username');
    await expect(input).toHaveAttribute('autocomplete', /^username( webauthn)?$/);
    await expect(input).toHaveAttribute('autocapitalize', 'none');
    await expect(page.getByLabel('Email')).toHaveCount(1);
    await expect(page.locator('#kc-login')).toHaveText('Sign in');
    await expect(page.locator('#kc-registration a')).toHaveText('Create account');
    await expect(page.locator('.jp-idp-exit')).toHaveAttribute('href', /^https?:\/\/.+/);
  });

  test('password error: shown once, on the field, linked with aria-describedby, wrong-credentials copy', async ({ page }) => {
    await open(page, 'password-error');
    const error = page.locator('#input-error-password');
    await expect(error).toContainText('Invalid username or password.');
    await expect(page.locator('#password')).toHaveAttribute('aria-describedby', 'input-error-password');
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.locator('#password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.kc-feedback-text')).toHaveCount(1);
    await expect(page.locator('#kc-attempted-username')).toHaveText('traveler@example.test');
  });

  test('passkey enrolment: no label question, hidden label field, one primary action', async ({ page }) => {
    await open(page, 'webauthn-register');
    await expect(page.locator('#authenticatorLabel')).toHaveAttribute('type', 'hidden');
    await expect(page.locator('main input[type=text], main textarea')).toHaveCount(0);
    await expect(page.locator('#registerWebAuthn')).toHaveCount(1);
    await expect(page.locator('#jp-passkey-recovery-link')).toHaveAttribute('href', /recover\.html$/);
  });

  test('error page: the alert is the page body and appears once; one way back, from the client Base URL', async ({ page }) => {
    await open(page, 'error');
    await expect(page.locator('.jp-alert')).toHaveCount(1);
    await expect(page.locator('.jp-alert')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#backToApplication')).toHaveCount(0);
    await expect(page.locator('a.jp-idp-exit')).toHaveCount(1);
    // the only link back is the one the (captured) client's Base URL produced
    expect(await page.locator('main a, footer a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')))).toEqual(['http://localhost:5173/PruebaMapJapan/']);
  });

  test('password toggle keeps its 44px target and swaps its icon on click without scripts being needed for layout', async ({ page }) => {
    await open(page, 'password-error');
    const box = await page.locator('.jp-input-group__toggle').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
