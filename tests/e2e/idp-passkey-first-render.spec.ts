import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Passkey-first sign-in, rendered: the real Keycloak 26.6.1 username page (the snapshot
 * tests/e2e/fixtures/idp-theme/username.html, scripts removed by capture.mjs) styled by the real
 * theme CSS, with the REAL theme script (js/passkey-first.js) added and WebAuthn replaced by
 * a controllable stand-in. No Keycloak, no authenticator: every state is deterministic.
 *
 * The states: plain (nothing remembered), prompting (this browser used a passkey here: the
 * panel replaces the form while the browser asks), dismissed (the user cancelled: the panel
 * stays, the form is back), success, and the browsers/devices where it must not prompt.
 * Light and dark, 375px and 1280px: no horizontal scroll, 16px gutters, 44px controls, AA
 * contrast, live-region announcements, focus, reduced motion, and axe when axe-core exists.
 * QA_SCREENSHOTS_DIR=<dir> saves a PNG per state.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-passkey-first-render --project=chromium
 */

const ROOT = path.resolve(__dirname, '../..');
const THEME = path.join(ROOT, 'keycloak/themes/japan-trip/login/resources');
const SNAPSHOTS = path.join(__dirname, 'fixtures/idp-theme');
const ORIGIN = 'http://idp.test';
const SHOTS = process.env['QA_SCREENSHOTS_DIR'];
const MARKER_KEY = 'jp.passkey.japan-trip';
const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.js': 'text/javascript' };

function loadAxe(): string | null {
  for (const file of [process.env['AXE_CORE_PATH'] ?? '', ...(() => { try { return [require.resolve('axe-core/axe.min.js')]; } catch { return []; } })()].filter(Boolean)) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      // next
    }
  }
  return null;
}
const AXE = loadAxe();

interface Scenario {
  /** a marker is in localStorage when the page loads (misses = how many prompts were dismissed) */
  marker?: { misses?: number } | false;
  /** this exact string is in localStorage when the page loads (corrupt-value cases) */
  rawMarker?: string;
  /** what navigator.credentials.get does for a modal request */
  get?: 'hang' | 'dismiss' | 'unsupported' | 'blocked' | 'succeed';
  /** window.PublicKeyCredential missing */
  noWebAuthn?: boolean;
  /** isUserVerifyingPlatformAuthenticatorAvailable() answer */
  platform?: boolean;
  /** the template says the page is not a plain sign-in (a message is shown) */
  notEligible?: boolean;
  /** isConditionalMediationAvailable() answer */
  autofill?: boolean;
}

/** Installed before any page script: the WebAuthn stand-in, the marker, and a log of every call. */
function installStandIn(page: Page, scenario: Scenario) {
  return page.addInitScript(
    ({ s, key }) => {
      const w = window as unknown as Record<string, unknown>;
      const log: { mediation: string | null; hasAllow: boolean; rpId?: string; uv?: string; challenge: number; timeout?: number }[] = [];
      w['__gets'] = log;
      const submitted: Record<string, string>[] = [];
      w['__submitted'] = submitted;
      if (!s.noWebAuthn) {
        const PKC = function () {} as unknown as { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>; isConditionalMediationAvailable: () => Promise<boolean> };
        PKC.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(s.platform !== false);
        PKC.isConditionalMediationAvailable = () => Promise.resolve(s.autofill === true);
        w['PublicKeyCredential'] = PKC;
      } else {
        delete w['PublicKeyCredential'];
      }
      const bytes = (...n: number[]) => Uint8Array.from(n).buffer;
      Object.defineProperty(navigator, 'credentials', {
        configurable: true,
        value: {
          get(options: { mediation?: string; publicKey: { rpId?: string; userVerification?: string; challenge: Uint8Array; allowCredentials?: unknown; timeout?: number }; signal?: AbortSignal }) {
            log.push({
              mediation: options.mediation ?? null,
              hasAllow: 'allowCredentials' in options.publicKey,
              rpId: options.publicKey.rpId,
              uv: options.publicKey.userVerification,
              challenge: options.publicKey.challenge.byteLength,
              timeout: options.publicKey.timeout,
            });
            if (options.mediation === 'conditional') {
              // the autofill request stays open until the page aborts it
              return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
            }
            switch (s.get) {
              case 'dismiss':
                return Promise.reject(new DOMException('cancelled', 'NotAllowedError'));
              case 'unsupported':
                return Promise.reject(new DOMException('no', 'NotSupportedError'));
              case 'blocked':
                return Promise.reject(new DOMException('no', 'SecurityError'));
              case 'succeed':
                return Promise.resolve({
                  id: 'Y3JlZGVudGlhbC1pZA',
                  response: { clientDataJSON: bytes(1, 2), authenticatorData: bytes(3, 4), signature: bytes(5, 6), userHandle: bytes(7, 8) },
                });
              default:
                return new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
            }
          },
        },
      });
      try {
        if (s.rawMarker !== undefined) localStorage.setItem(key, s.rawMarker);
        else if (s.marker) localStorage.setItem(key, JSON.stringify({ v: 1, t: Date.now(), m: s.marker.misses ?? 0 }));
        else localStorage.removeItem(key);
      } catch {
        // storage unavailable
      }
      // Record what the page posts instead of leaving the page
      document.addEventListener(
        'submit',
        (event) => {
          const form = event.target as HTMLFormElement;
          if (form.id !== 'webauth') return;
          event.preventDefault();
          submitted.push(Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)])));
        },
        true,
      );
    },
    { s: scenario, key: MARKER_KEY },
  );
}

async function open(page: Page, scenario: Scenario = {}, { module = true, framed = false } = {}) {
  await installStandIn(page, scenario);
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/host.html') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>host</title><iframe id="f" src="/username.html" width="400" height="800"></iframe>' });
    }
    const file = url.pathname.startsWith('/resources/login/japan-trip/')
      ? path.join(THEME, url.pathname.replace('/resources/login/japan-trip/', ''))
      : path.join(SNAPSHOTS, url.pathname.slice(1));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
    let body: string | Buffer = fs.readFileSync(file);
    if (file.endsWith('username.html')) {
      let html = body.toString('utf8');
      if (scenario.notEligible) html = html.replace('data-auto="true"', 'data-auto="false"');
      body = html;
    }
    return route.fulfill({ body, contentType: TYPES[path.extname(file)] ?? 'text/plain' });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  if (framed) {
    await page.goto(`${ORIGIN}/host.html`);
    const frame = page.frameLocator('#f');
    await frame.locator('#kc-form').waitFor();
    return;
  }
  await page.goto(`${ORIGIN}/username.html`);
  await page.waitForLoadState('domcontentloaded');
  if (module) await page.addScriptTag({ type: 'module', url: '/resources/login/japan-trip/js/passkey-first.js' });
}

type Get = { mediation: string | null; hasAllow: boolean; rpId?: string; uv?: string; challenge: number; timeout?: number };
const gets = (page: Page) => page.evaluate(() => (window as unknown as { __gets: Get[] }).__gets);
const modalGets = async (page: Page) => (await gets(page)).filter((g) => g.mediation !== 'conditional');
const storedMarker = (page: Page) => page.evaluate((k) => localStorage.getItem(k), MARKER_KEY);

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
      const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(backdrop(el))];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  });
}

/** Each state: how to set the page up, and what must be on screen. */
const STATES: { name: string; scenario: Scenario; ready: (page: Page) => Promise<void> }[] = [
  {
    name: 'plain',
    scenario: { marker: false, autofill: true },
    ready: async (page) => {
      await expect(page.locator('#jp-passkey-button')).toBeVisible();
      await expect(page.locator('#jp-passkey-first')).toBeHidden();
    },
  },
  {
    name: 'prompting',
    scenario: { marker: {}, get: 'hang' },
    ready: async (page) => {
      await expect(page.locator('#jp-passkey-first')).toBeVisible();
      await expect(page.locator('#jp-passkey-status')).toHaveText(/Confirm with your passkey/);
      await expect(page.locator('#kc-form')).toBeHidden();
    },
  },
  {
    name: 'dismissed',
    scenario: { marker: {}, get: 'dismiss' },
    ready: async (page) => {
      await expect(page.locator('#jp-passkey-status')).toHaveText(/cancelled/);
      await expect(page.locator('#kc-form')).toBeVisible();
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const [label, viewport] of [['375px', { width: 375, height: 740 }], ['1280px', { width: 1280, height: 800 }]] as const) {
    test.describe(`passkey-first states, ${scheme}, ${label}`, () => {
      test.use({ viewport, colorScheme: scheme, storageState: { cookies: [], origins: [] } });

      for (const state of STATES) {
        test.describe(state.name, () => {
          test.beforeEach(async ({ page }) => {
            await open(page, state.scenario);
            await state.ready(page);
          });

          test.afterEach(async ({ page }) => {
            if (SHOTS) {
              fs.mkdirSync(SHOTS, { recursive: true });
              await page.screenshot({ path: path.join(SHOTS, `${state.name}-${scheme}-${label}.png`), fullPage: true });
            }
          });

          test('one card, one h1, nothing boxed inside the panel', async ({ page }) => {
            await expect(page.locator('main.jp-card')).toHaveCount(1);
            await expect(page.locator('.jp-card .jp-card')).toHaveCount(0);
            await expect(page.locator('h1')).toHaveCount(1);
            // the panel is flat: no border, no background of its own
            const panel = await page.locator('#jp-passkey-first').evaluate((el) => {
              const s = getComputedStyle(el);
              return { border: s.borderTopWidth, bg: s.backgroundColor };
            });
            expect(panel).toEqual({ border: '0px', bg: 'rgba(0, 0, 0, 0)' });
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
            }
          });

          test('every visible control is at least 44px tall and wide', async ({ page }) => {
            const small = await page.locator('main.jp-card').locator('input:not([type=hidden]):not([type=checkbox]), button, a.jp-btn, #kc-info a').evaluateAll((els) =>
              els
                .filter((el) => el.getBoundingClientRect().width > 0)
                .map((el) => ({ el: `${el.tagName.toLowerCase()}#${el.id}`, h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
                .filter((x) => x.h < 44 || x.w < 44),
            );
            expect(small).toEqual([]);
          });

          test('text has AA contrast (4.5:1), the status line included', async ({ page }) => {
            for (const selector of ['h1', '.jp-subtitle', '.jp-passkey-lead', '#jp-passkey-status', '#jp-passkey-alt-status', 'label', '.jp-btn--primary', '.jp-btn--secondary']) {
              for (const ratio of await contrastOf(page, `${selector}:visible`)) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
            }
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

test.describe('passkey-first behaviour (rendered page, WebAuthn stand-in)', () => {
  test.use({ viewport: { width: 375, height: 740 }, storageState: { cookies: [], origins: [] } });

  test('no marker: the plain form, a passkey button, autofill requested, no prompt of its own', async ({ page }) => {
    await open(page, { marker: false, autofill: true });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect(page.locator('#kc-page-subtitle')).toBeVisible();
    await expect.poll(async () => (await gets(page)).length).toBe(1);
    const [call] = await gets(page);
    expect(call).toMatchObject({ mediation: 'conditional', hasAllow: false, rpId: 'localhost', uv: 'required' });
    expect(call!.challenge).toBeGreaterThan(8);
    expect(await modalGets(page)).toEqual([]);
  });

  test('no marker, no autofill support: no request at all until the user presses the button', async ({ page }) => {
    await open(page, { marker: false, autofill: false, get: 'dismiss' });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    expect(await gets(page)).toEqual([]);
    await page.locator('#jp-passkey-button').click();
    await expect(page.locator('#jp-passkey-alt-status')).toHaveText(/cancelled/);
    expect((await modalGets(page)).length).toBe(1);
    // a cancel from the button is the user's choice, not a missed automatic prompt
    expect(await storedMarker(page)).toBeNull();
    await expect(page.locator('#username')).toBeEnabled();
  });

  test('marker: the prompt starts by itself, discoverable (no allowCredentials), with the realm\'s settings', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang' });
    await expect.poll(async () => (await modalGets(page)).length).toBe(1);
    const [call] = await modalGets(page);
    expect(call).toMatchObject({ mediation: null, hasAllow: false, rpId: 'localhost', uv: 'required' });
    // the panel replaced the form, the live region says what to do, the button waits
    await expect(page.locator('#jp-passkey-first')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#jp-passkey-status')).toHaveAttribute('role', 'status');
    await expect(page.locator('#jp-passkey-status')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('#jp-passkey-continue')).toBeDisabled();
    await expect(page.locator('#jp-passkey-other')).toBeVisible();
    await expect(page.locator('#kc-form')).toBeHidden();
    await expect(page.locator('#kc-page-subtitle')).toBeHidden();
    await expect(page.locator('#jp-passkey-alt')).toBeHidden();
    // the sign-up link is still on the page
    await expect(page.locator('#kc-registration a')).toBeVisible();
  });

  test('the answer is posted as Keycloak expects it, and the marker is renewed', async ({ page }) => {
    await open(page, { marker: {}, get: 'succeed' });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __submitted: unknown[] }).__submitted.length)).toBe(1);
    const [posted] = await page.evaluate(() => (window as unknown as { __submitted: Record<string, string>[] }).__submitted);
    expect(posted).toMatchObject({
      clientDataJSON: 'AQI',
      authenticatorData: 'AwQ',
      signature: 'BQY',
      credentialId: 'Y3JlZGVudGlhbC1pZA',
      userHandle: 'Bwg',
      error: '',
    });
    expect(posted).not.toHaveProperty('username');
    await expect(page.locator('#jp-passkey-status')).toHaveText(/Signing you in/);
    expect(JSON.parse((await storedMarker(page))!)).toMatchObject({ v: 1, m: 0 });
  });

  test('cancel: the status says so and takes focus off nothing; the form is back, the button is on Continue', async ({ page }) => {
    await open(page, { marker: {}, get: 'dismiss' });
    await expect(page.locator('#jp-passkey-status')).toHaveText('Passkey sign-in was cancelled. Try again, or continue with your email.');
    await expect(page.locator('#jp-passkey-continue')).toBeFocused();
    await expect(page.locator('#jp-passkey-continue')).toBeEnabled();
    await expect(page.locator('#jp-passkey-other')).toBeHidden(); // the form is already there
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect(page.locator('#username')).toBeEnabled();
    await expect(page.locator('#jp-passkey-first')).toHaveAttribute('aria-busy', 'false');
    // one automatic prompt, no loop
    expect((await modalGets(page)).length).toBe(1);
    // the dismissal counted; the marker is still there
    expect(JSON.parse((await storedMarker(page))!)).toMatchObject({ v: 1, m: 1 });
  });

  test('after a cancel the autofill list is requested, so the e-mail field still offers passkeys', async ({ page }) => {
    await open(page, { marker: {}, get: 'dismiss', autofill: true });
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect.poll(async () => (await gets(page)).filter((g) => g.mediation === 'conditional').length).toBe(1);
  });

  test('cancel, then "Continue with passkey": a second request from a user gesture', async ({ page }) => {
    await open(page, { marker: {}, get: 'dismiss' });
    await expect(page.locator('#jp-passkey-status')).toHaveText(/cancelled/);
    await page.locator('#jp-passkey-continue').click();
    await expect(page.locator('#jp-passkey-status')).toHaveText(/cancelled/); // dismissed again
    expect((await modalGets(page)).length).toBe(2);
    // only the automatic one counted as a miss
    expect(JSON.parse((await storedMarker(page))!)).toMatchObject({ m: 1 });
  });

  test('two dismissed automatic prompts in a row drop the marker', async ({ page }) => {
    await open(page, { marker: { misses: 1 }, get: 'dismiss' });
    await expect(page.locator('#jp-passkey-status')).toHaveText(/cancelled/);
    expect(await storedMarker(page)).toBeNull();
  });

  for (const get of ['unsupported', 'blocked'] as const) {
    test(`a ${get} WebAuthn call says so and leaves the form usable, without counting a miss`, async ({ page }) => {
      await open(page, { marker: {}, get });
      await expect(page.locator('#jp-passkey-status')).toHaveText(/cannot use a passkey/);
      await expect(page.locator('#username')).toBeEnabled();
      expect(JSON.parse((await storedMarker(page))!)).toMatchObject({ m: 0 });
    });
  }

  test('"Use another account": the open prompt is aborted, the form takes focus, nothing else prompts', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang', autofill: false });
    await expect(page.locator('#jp-passkey-other')).toBeVisible();
    await page.locator('#jp-passkey-other').click();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect(page.locator('#username')).toBeFocused();
    await expect(page.locator('#jp-passkey-alt')).toBeVisible(); // the passkey is still one click away
    expect((await modalGets(page)).length).toBe(1);
    // The memory goes when that other account signs in (not before)
    expect(await storedMarker(page)).not.toBeNull();
    await page.locator('#username').fill('someone.else@example.test');
    await page.evaluate(() => document.querySelector('#kc-form-login')!.addEventListener('submit', (e) => e.preventDefault(), true));
    await page.locator('#kc-login').click();
    expect(await storedMarker(page)).toBeNull();
  });

  test('"Use another account" never touches what the user types', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang' });
    await page.locator('#jp-passkey-other').click();
    await expect(page.locator('#username')).toHaveValue('');
  });

  test('no WebAuthn in the browser: plain form, no passkey button, no prompt, whatever is remembered', async ({ page }) => {
    await open(page, { marker: {}, noWebAuthn: true });
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    await expect(page.locator('#jp-passkey-alt')).toBeHidden();
    expect(await gets(page)).toEqual([]);
    // the e-mail recovery of the footer is not touched by this script
    await expect(page.locator('#username')).toBeEnabled();
  });

  test('no user-verifying platform authenticator: plain form, the marker is kept for a better day', async ({ page }) => {
    await open(page, { marker: {}, platform: false });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    await expect(page.locator('#kc-form')).toBeVisible();
    expect(await modalGets(page)).toEqual([]);
    expect(await storedMarker(page)).not.toBeNull();
  });

  test('a page that carries a message (error, expired session) never prompts by itself', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang', notEligible: true });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    expect(await modalGets(page)).toEqual([]);
  });

  test('inside an iframe it never prompts by itself', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang' }, { framed: true });
    const frame = page.frames().find((f) => f.url().endsWith('/username.html'))!;
    await frame.addScriptTag({ type: 'module', url: '/resources/login/japan-trip/js/passkey-first.js' });
    await expect(frame.locator('#jp-passkey-button')).toBeVisible();
    await expect(frame.locator('#jp-passkey-first')).toBeHidden();
    expect(await frame.evaluate(() => (window as unknown as { __gets: unknown[] }).__gets.filter((g) => (g as { mediation: string | null }).mediation !== 'conditional'))).toEqual([]);
  });

  test('a reload is not a new sign-in: no second prompt', async ({ page }) => {
    await open(page, { marker: {}, get: 'dismiss' });
    await expect(page.locator('#jp-passkey-status')).toHaveText(/cancelled/);
    expect((await modalGets(page)).length).toBe(1);
    await page.reload();
    await page.addScriptTag({ type: 'module', url: '/resources/login/japan-trip/js/passkey-first.js' });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    expect((await modalGets(page)).length).toBe(0); // the stand-in is rebuilt on load: nothing was asked
  });

  test('without the script, or when it fails, the page is the plain form', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang' }, { module: false });
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    await expect(page.locator('#jp-passkey-alt')).toBeHidden();
    await expect(page.locator('#kc-login')).toBeVisible();
  });

  test('a challenge that is not base64url leaves the plain form (nothing is sent)', async ({ page }) => {
    await open(page, { marker: {}, get: 'hang' }, { module: false });
    await page.evaluate(() => document.getElementById('jp-passkey')!.setAttribute('data-challenge', 'not+base64url/'));
    await page.addScriptTag({ type: 'module', url: '/resources/login/japan-trip/js/passkey-first.js' });
    await expect(page.locator('#kc-form')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    expect(await gets(page)).toEqual([]);
  });

  test('a corrupt marker is ignored: plain page, and the bad value is removed', async ({ page }) => {
    await open(page, { rawMarker: '{"v":1,"t":"yesterday","m":0,"user":"a@b.c"}', get: 'hang' });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    await expect(page.locator('#jp-passkey-first')).toBeHidden();
    expect(await modalGets(page)).toEqual([]);
    expect(await storedMarker(page)).toBeNull();
  });

  test('blocked storage: the page works, nothing is remembered', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
      });
    });
    await open(page, { marker: false, get: 'dismiss', autofill: false });
    await expect(page.locator('#jp-passkey-button')).toBeVisible();
    await page.locator('#jp-passkey-button').click();
    await expect(page.locator('#jp-passkey-alt-status')).toHaveText(/cancelled/);
    await expect(page.locator('#username')).toBeEnabled();
  });

  test('the passkey button and panel are reachable by keyboard, in a sensible order', async ({ page }) => {
    await open(page, { marker: {}, get: 'dismiss' });
    await expect(page.locator('#jp-passkey-continue')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#username')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter'); // Continue with passkey, from the keyboard
    expect((await modalGets(page)).length).toBe(2);
  });

  test('reduced motion: the waiting pulse does not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { marker: {}, get: 'hang' });
    await expect(page.locator('#jp-passkey-first')).toBeVisible();
    expect(await page.locator('.jp-passkey-hero').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });

  test('the waiting pulse animates when motion is allowed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, { marker: {}, get: 'hang' });
    await expect(page.locator('#jp-passkey-first')).toBeVisible();
    expect(await page.locator('.jp-passkey-hero').evaluate((el) => getComputedStyle(el).animationName)).toBe('jp-pulse');
  });
});
