import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
// The label generator is a plain ES module shipped as a theme resource (also loaded by the
// browser on the passkey page); Playwright's loader transpiles it for these tests.
import {
  MAX_LABEL_LENGTH,
  buildPasskeyLabel,
  detectDevice,
  formatLabelDate,
  formatLabelStamp,
  installDeviceLabel,
} from '../../keycloak/themes/japan-trip/login/resources/js/passkey-label.js';

/**
 * Keycloak login theme, no Keycloak and no browser needed:
 *   1. the passkey label generator (pure function, table tests);
 *   2. the wiring that replaces Keycloak's "name your passkey" prompt;
 *   3. static checks of the templates, theme.properties, CSS and messages.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-theme-static --project=chromium
 *
 * Rendered pages (real Keycloak output, light/dark, 375px/1280px) are covered by
 * idp-theme-render.spec.ts; the live flow by idp-theme.spec.ts.
 */

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = path.join(ROOT, 'keycloak/themes/japan-trip/login');
const read = (file: string) => fs.readFileSync(path.join(LOGIN, file), 'utf-8');

// ---------------------------------------------------------------------------
// 1. Passkey label generator
// ---------------------------------------------------------------------------

/** 8 Oct 2026, built from local components: the label uses the device's local date. */
const NOW = new Date(2026, 9, 8, 13, 45);
const SUFFIX = ' (2026-10-08 13:45)';

const UA = {
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  chromeAndroidReduced:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  edgeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  firefoxIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  edgeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.0 Mobile/15E148 Safari/605.1.15',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
  vivaldiLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Vivaldi/6.8',
  firefoxLinux: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  headlessChromeLinux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const labelOf = (userAgent: string | undefined, extra: Record<string, unknown> = {}) =>
  buildPasskeyLabel({ userAgent, now: NOW, ...extra });

test.describe('passkey label generator', () => {
  const table: [string, string, string][] = [
    ['Chrome on Android', UA.chromeAndroid, 'Chrome on Android'],
    ['Chrome on Android, reduced UA', UA.chromeAndroidReduced, 'Chrome on Android'],
    ['Samsung Internet (also says Chrome)', UA.samsungInternet, 'Samsung Internet on Android'],
    ['Firefox on Android', UA.firefoxAndroid, 'Firefox on Android'],
    ['Edge on Android (EdgA)', UA.edgeAndroid, 'Edge on Android'],
    ['Safari on iPhone', UA.safariIphone, 'Safari on iPhone'],
    ['Chrome on iPhone (CriOS)', UA.chromeIphone, 'Chrome on iPhone'],
    ['Firefox on iPhone (FxiOS)', UA.firefoxIphone, 'Firefox on iPhone'],
    ['Edge on iPhone (EdgiOS)', UA.edgeIphone, 'Edge on iPhone'],
    ['Safari on iPad', UA.safariIpad, 'Safari on iPad'],
    ['Safari on Mac', UA.safariMac, 'Safari on Mac'],
    ['Chrome on Mac (not Safari)', UA.chromeMac, 'Chrome on Mac'],
    ['Chrome on Windows', UA.chromeWindows, 'Chrome on Windows'],
    ['Edge on Windows (not Chrome)', UA.edgeWindows, 'Edge on Windows'],
    ['Opera on Windows (not Chrome)', UA.operaWindows, 'Opera on Windows'],
    ['Vivaldi on Linux', UA.vivaldiLinux, 'Vivaldi on Linux'],
    ['Firefox on Linux', UA.firefoxLinux, 'Firefox on Linux'],
    ['Firefox on Windows', UA.firefoxWindows, 'Firefox on Windows'],
    ['headless Chrome on Linux (what CI runs)', UA.headlessChromeLinux, 'Chrome on Linux'],
    ['Chrome on ChromeOS', UA.chromeOs, 'Chrome on ChromeOS'],
  ];

  for (const [name, userAgent, expected] of table) {
    test(`${name}`, () => {
      expect(labelOf(userAgent)).toBe(`${expected}${SUFFIX}`);
    });
  }

  test('iPadOS 13+ sends a Mac user agent: the touch screen tells it apart', () => {
    expect(labelOf(UA.safariMac, { maxTouchPoints: 5 })).toBe(`Safari on iPad${SUFFIX}`);
    expect(labelOf(UA.safariMac, { maxTouchPoints: 0 })).toBe(`Safari on Mac${SUFFIX}`);
    expect(labelOf(UA.safariMac, { maxTouchPoints: 1 })).toBe(`Safari on Mac${SUFFIX}`);
  });

  test.describe('navigator.userAgentData wins over the (reduced) user agent string', () => {
    const grease = { brand: 'Not.A/Brand', version: '8' };
    const cases: [string, { brands: { brand: string }[]; platform: string }, string | undefined, string][] = [
      ['Chrome on Android', { brands: [grease, { brand: 'Chromium' }, { brand: 'Google Chrome' }], platform: 'Android' }, UA.chromeAndroidReduced, 'Chrome on Android'],
      ['Edge on Windows', { brands: [{ brand: 'Microsoft Edge' }, { brand: 'Chromium' }, grease], platform: 'Windows' }, UA.chromeWindows, 'Edge on Windows'],
      ['Brave says so', { brands: [{ brand: 'Brave' }, { brand: 'Chromium' }, grease], platform: 'macOS' }, UA.chromeMac, 'Brave on Mac'],
      ['Opera', { brands: [{ brand: 'Opera' }, { brand: 'Chromium' }], platform: 'Linux' }, undefined, 'Opera on Linux'],
      ['Chromium that does not say who it is', { brands: [grease, { brand: 'Chromium' }], platform: 'Linux' }, undefined, 'Chrome on Linux'],
      ['Chrome OS platform string', { brands: [{ brand: 'Google Chrome' }], platform: 'Chrome OS' }, undefined, 'Chrome on ChromeOS'],
      ['platform casing is ignored', { brands: [{ brand: 'Google Chrome' }], platform: 'WINDOWS' }, undefined, 'Chrome on Windows'],
    ];
    for (const [name, uaData, userAgent, expected] of cases) {
      test(name, () => {
        expect(labelOf(userAgent, { uaData })).toBe(`${expected}${SUFFIX}`);
      });
    }

    test('brands the table does not know fall back to the user agent string', () => {
      const uaData = { brands: [{ brand: 'SomeNewBrowser' }], platform: '' };
      expect(labelOf(UA.firefoxLinux, { uaData })).toBe(`Firefox on Linux${SUFFIX}`);
    });

    test('malformed userAgentData never throws', () => {
      for (const uaData of [null, 42, 'x', {}, { brands: null }, { brands: [null, 1, {}, { brand: 7 }] }, { platform: 7 }, { platform: 'constructor' }, { platform: '__proto__' }, { platform: 'toString' }]) {
        expect(() => labelOf(UA.safariIphone, { uaData })).not.toThrow();
        expect(labelOf(UA.safariIphone, { uaData })).toBe(`Safari on iPhone${SUFFIX}`);
      }
    });

    test('iOS from userAgentData stays iPad when the string says iPad', () => {
      const uaData = { brands: [], platform: 'iOS' };
      expect(labelOf(UA.safariIpad, { uaData })).toBe(`Safari on iPad${SUFFIX}`);
      expect(labelOf(UA.safariIphone, { uaData })).toBe(`Safari on iPhone${SUFFIX}`);
    });
  });

  test.describe('poor or missing user agent information: fallback "Passkey (<date>)"', () => {
    const poor: [string, unknown][] = [
      ['empty string', ''],
      ['undefined', undefined],
      ['null', null],
      ['whitespace', '   \t\n'],
      ['a number', 12345],
      ['an object', {}],
      ['curl', 'curl/8.4.0'],
      ['an unknown bot', 'Mozilla/5.0 (compatible; SomethingNew/1.0; +http://example.test/bot)'],
      ['garbage', '\u0000\u0001��;;;((('],
    ];
    for (const [name, userAgent] of poor) {
      test(name, () => {
        expect(buildPasskeyLabel({ userAgent: userAgent as string, now: NOW })).toBe(`Passkey${SUFFIX}`);
      });
    }

    test('no arguments at all still gives a dated label', () => {
      expect(buildPasskeyLabel()).toMatch(/^Passkey \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
    });

    test('only the system known: "Passkey on Linux"', () => {
      expect(labelOf('Mozilla/5.0 (X11; Linux x86_64)')).toBe(`Passkey on Linux${SUFFIX}`);
    });

    test('only the browser known: just the browser', () => {
      expect(labelOf('Firefox/127.0')).toBe(`Firefox${SUFFIX}`);
    });
  });

  test.describe('date and time suffix', () => {
    test('is local, zero-padded and unique per minute', () => {
      expect(labelOf(UA.safariIphone, { now: new Date(2026, 0, 5, 23, 59) })).toBe('Safari on iPhone (2026-01-05 23:59)');
      expect(labelOf(UA.safariIphone, { now: new Date(2026, 11, 31, 0, 0) })).toBe('Safari on iPhone (2026-12-31 00:00)');
      expect(labelOf(UA.safariIphone, { now: new Date(2026, 9, 8) })).not.toBe(labelOf(UA.safariIphone, { now: new Date(2026, 9, 9) }));
      // the owner's case: two passkeys on one phone on one day used to collide
      expect(labelOf(UA.chromeAndroid, { now: new Date(2026, 9, 9, 14, 41) })).toBe('Chrome on Android (2026-10-09 14:41)');
      expect(labelOf(UA.chromeAndroid, { now: new Date(2026, 9, 9, 9, 5) })).not.toBe(labelOf(UA.chromeAndroid, { now: new Date(2026, 9, 9, 9, 6) }));
    });

    test('formatLabelStamp is date, space, 24-hour time; empty for anything that is not a valid Date', () => {
      expect(formatLabelStamp(new Date(2026, 9, 9, 0, 0))).toBe('2026-10-09 00:00');
      expect(formatLabelStamp(new Date(2026, 9, 9, 23, 59, 59))).toBe('2026-10-09 23:59');
      expect(formatLabelStamp(new Date(NaN))).toBe('');
      expect(formatLabelStamp(undefined as unknown as Date)).toBe('');
      expect(formatLabelStamp('2026-10-09 14:41' as unknown as Date)).toBe('');
    });

    test('formatLabelDate rejects everything that is not a valid Date', () => {
      expect(formatLabelDate(new Date(NaN))).toBe('');
      expect(formatLabelDate('2026-10-08' as unknown as Date)).toBe('');
      expect(formatLabelDate(null as unknown as Date)).toBe('');
      expect(formatLabelDate(NOW)).toBe('2026-10-08');
    });

    test('an unusable clock drops the suffix instead of printing "Invalid Date"', () => {
      expect(labelOf(UA.safariIphone, { now: new Date(NaN) })).toBe('Safari on iPhone');
      expect(labelOf('', { now: 'yesterday' })).toBe('Passkey');
    });
  });

  test.describe('length and characters', () => {
    const noLoneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

    test('very long translated words never push the label past the limit, and the date survives', () => {
      const long = 'x'.repeat(500);
      const label = labelOf(UA.safariIphone, { joiner: long, fallback: long });
      expect(label.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
      expect(label.endsWith(SUFFIX)).toBe(true);
      const unknown = labelOf('', { fallback: long });
      expect(unknown.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
      expect(unknown.endsWith(SUFFIX)).toBe(true);
    });

    test('a maxLength smaller than the suffix still yields a non-empty label within the limit', () => {
      for (const maxLength of [1, 5, 13, 14, 20]) {
        const label = labelOf(UA.chromeAndroid, { maxLength });
        expect(label.length, `maxLength ${maxLength}`).toBeLessThanOrEqual(Math.max(maxLength, 1));
        expect(label.length).toBeGreaterThan(0);
      }
    });

    test('nonsense maxLength falls back to the default', () => {
      for (const maxLength of [0, -3, NaN, undefined, 'abc']) {
        expect(labelOf(UA.chromeAndroid, { maxLength })).toBe(`Chrome on Android${SUFFIX}`);
      }
    });

    test('unicode words are kept (Spanish, CJK, accents)', () => {
      expect(labelOf(UA.chromeAndroid, { joiner: 'en' })).toBe(`Chrome en Android${SUFFIX}`);
      expect(labelOf('', { fallback: 'Clave de acceso' })).toBe(`Clave de acceso${SUFFIX}`);
      expect(labelOf('', { fallback: 'パスキー' })).toBe(`パスキー${SUFFIX}`);
      expect(labelOf(UA.safariIphone, { joiner: 'を使用' })).toBe(`Safari を使用 iPhone${SUFFIX}`);
    });

    test('truncation never splits a surrogate pair (emoji)', () => {
      const emoji = '\u{1F511}'.repeat(80); // 160 UTF-16 units
      for (const maxLength of [20, 21, 22, 23, 33, 64]) {
        const label = labelOf('', { fallback: emoji, maxLength });
        expect(label, `maxLength ${maxLength}`).not.toMatch(noLoneSurrogate);
        expect(label.length).toBeLessThanOrEqual(maxLength);
        expect(label.endsWith(SUFFIX)).toBe(true);
      }
    });

    test('control characters, newlines and bidi overrides are replaced, whitespace collapsed', () => {
      const label = labelOf('', { fallback: 'Pass\u0000key\n\t  one‮two' });
      expect(label).toBe(`Pass key one two${SUFFIX}`);
      expect(labelOf(UA.safariIphone, { joiner: '\n' })).toBe(`Safari on iPhone${SUFFIX}`);
    });

    test('an empty or blank translation falls back to the English default', () => {
      expect(labelOf(UA.safariIphone, { joiner: '' })).toBe(`Safari on iPhone${SUFFIX}`);
      expect(labelOf(UA.safariIphone, { joiner: '   ' })).toBe(`Safari on iPhone${SUFFIX}`);
      expect(labelOf('', { fallback: '' })).toBe(`Passkey${SUFFIX}`);
      expect(labelOf('', { fallback: null })).toBe(`Passkey${SUFFIX}`);
    });

    test('a hostile user agent cannot inject anything into the label', () => {
      const label = labelOf('<script>alert(1)</script> Chrome/1 Android "\'; DROP TABLE');
      expect(label).toBe(`Chrome on Android${SUFFIX}`);
    });
  });

  test('detectDevice reports empty strings, not undefined, when nothing is known', () => {
    expect(detectDevice()).toEqual({ browser: '', system: '' });
    expect(detectDevice({ userAgent: UA.operaWindows })).toEqual({ browser: 'Opera', system: 'Windows' });
  });
});

// ---------------------------------------------------------------------------
// 2. Replacing Keycloak's "name your passkey" prompt
// ---------------------------------------------------------------------------

test.describe('installDeviceLabel', () => {
  // a usable but empty localStorage (a blocked one gets a random suffix: idp-passkey-labels-static.spec.ts)
  const NO_MEMORY = { getItem: () => null, setItem: () => undefined };
  function fakePage(errorValue = '') {
    const listeners: Record<string, (() => void)[]> = {};
    const fields: Record<string, { value: string }> = {
      '#authenticatorLabel': { value: '' },
      '#error': { value: errorValue },
    };
    const form = {
      addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
      querySelector: (selector: string) => fields[selector] ?? null,
    };
    const prompts: unknown[][] = [];
    const win = { prompt: (...args: unknown[]) => (prompts.push(args), 'typed by a human') };
    return { form, win, fields, listeners, prompts };
  }
  const nav = { userAgent: UA.chromeAndroid, userAgentData: undefined, maxTouchPoints: 5 };

  test("window.prompt answers with the device label and ignores Keycloak's default text", () => {
    const { form, win, prompts } = fakePage();
    installDeviceLabel({ form: form as never, window: win as never, navigator: nav as never, storage: NO_MEMORY as never });
    const answer = win.prompt('Please input your registered Passkey\'s label', 'Passkey (Default Label)');
    expect(answer).toMatch(/^Chrome on Android \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
    expect(prompts, 'the native prompt must never be shown').toHaveLength(0);
  });

  test('the hidden authenticatorLabel field is filled on submit', () => {
    const { form, win, fields, listeners } = fakePage();
    installDeviceLabel({ form: form as never, window: win as never, navigator: nav as never, storage: NO_MEMORY as never });
    expect(listeners['submit']).toHaveLength(1);
    listeners['submit']![0]!();
    expect(fields['#authenticatorLabel']!.value).toMatch(/^Chrome on Android \(/);
  });

  test('a failed registration (error field set) does not get a label', () => {
    const { form, win, fields, listeners } = fakePage('NotAllowedError');
    installDeviceLabel({ form: form as never, window: win as never, navigator: nav as never, storage: NO_MEMORY as never });
    listeners['submit']![0]!();
    expect(fields['#authenticatorLabel']!.value).toBe('');
  });

  test('translated words come from the page; a browser without navigator data still works', () => {
    const { form, win } = fakePage();
    const { label } = installDeviceLabel({
      form: form as never,
      window: win as never,
      navigator: undefined as never,
      storage: NO_MEMORY as never,
      text: { joiner: 'en', fallback: 'Clave de acceso' },
    });
    expect(label()).toMatch(/^Clave de acceso \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
  });
});

// ---------------------------------------------------------------------------
// 3. Static checks of the theme files
// ---------------------------------------------------------------------------

function walk(dir: string, ext: string[], out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const templates = walk(LOGIN, ['.ftl']);
const css = read('resources/css/login.css');
const themeProps = read('theme.properties');
const props = Object.fromEntries(
  themeProps
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

test.describe('theme files', () => {
  test('extends the abstract base theme, not the PatternFly one', () => {
    expect(props['parent']).toBe('base');
    expect(props['styles']).toBe('css/login.css');
    expect(props['stylesCommon'], 'no PatternFly/Bootstrap CSS from the common resources').toBeUndefined();
    expect(css).not.toMatch(/@import/);
  });

  test('every template used by the browser flow has a theme override or is covered by base + CSS', () => {
    for (const f of ['template.ftl', 'footer.ftl', 'login-username.ftl', 'login-password.ftl', 'login.ftl', 'login-reset-password.ftl', 'info.ftl', 'error.ftl', 'webauthn-register.ftl']) {
      expect(fs.existsSync(path.join(LOGIN, f)), f).toBe(true);
    }
    // Keycloak's page ids are login-verify-email.ftl / login-otp.ftl: the old "verify-email.ftl" never rendered.
    expect(fs.existsSync(path.join(LOGIN, 'verify-email.ftl'))).toBe(false);
  });

  test('every kc* property a theme template reads is defined in theme.properties', () => {
    for (const file of templates) {
      for (const m of fs.readFileSync(file, 'utf-8').matchAll(/properties\.(kc[A-Za-z]+)/g)) {
        expect(props, `${path.relative(ROOT, file)} uses ${m[1]}`).toHaveProperty(m[1]!);
      }
    }
  });

  test('no theme-owned template has an inline event handler or inline style', () => {
    for (const file of templates) {
      const src = fs.readFileSync(file, 'utf-8');
      expect(src, path.relative(ROOT, file)).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
      expect(src, path.relative(ROOT, file)).not.toMatch(/\sstyle\s*=\s*["']/i);
      // inline scripts are only the module scripts that pass Keycloak's own values to its JS
      for (const m of src.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)) {
        expect(m[1], `${path.relative(ROOT, file)}: inline <script>`).toMatch(/type="module"|type="importmap"/);
      }
    }
  });

  test('the way back to the app is the client Base URL only: no localhost fallback anywhere in the theme', () => {
    for (const file of walk(path.join(ROOT, 'keycloak/themes/japan-trip/login'), ['.ftl', '.properties', '.js', '.css'])) {
      expect(fs.readFileSync(file, 'utf-8'), path.relative(ROOT, file)).not.toMatch(/localhost|127\.0\.0\.1|appUrl\s*=\s*http/);
    }
    const footer = read('footer.ftl');
    expect(footer).toMatch(/\(client\.baseUrl\)!''/);
    expect(footer).toMatch(/<#if appUrl\?has_content>/);
    // the error page links only to addresses Keycloak or the client provide, never a literal one
    expect(read('error.ftl')).not.toMatch(/href="(?!\$\{)/);
  });

  test('login pages carry the autocomplete tokens password managers and conditional UI need', () => {
    const username = read('login-username.ftl');
    expect(username).toMatch(/enableWebAuthnConditionalUI\?has_content\)\?then\('username webauthn', 'username'\)/);
    expect(username).toMatch(/autocapitalize="none"/);
    expect(read('login-password.ftl')).toMatch(/autocomplete="current-password"/);
    expect(read('login.ftl')).toMatch(/autocomplete="current-password"/);
    expect(read('login.ftl')).toMatch(/'username webauthn', 'username'/);
    // inputs never rely on the placeholder: each one has a <label for=...>
    for (const f of ['login-username.ftl', 'login-password.ftl', 'login.ftl', 'login-reset-password.ftl']) {
      const src = read(f);
      for (const id of [...src.matchAll(/<input[^>]*\sid="(username|password)"/g)].map((m) => m[1])) {
        expect(src, `${f}: label for ${id}`).toMatch(new RegExp(`<label for="${id}"`));
      }
    }
  });

  test('passkey enrolment never asks for a label: hidden field, device label script, no text input', () => {
    const src = read('webauthn-register.ftl');
    expect(src).toMatch(/<input type="hidden" id="authenticatorLabel" name="authenticatorLabel"\/>/);
    expect(src).toMatch(/from "\$\{url\.resourcesPath\}\/js\/passkey-label\.js\?v=\$\{properties\.jpAssetVersion!\}"/);
    expect(src).toMatch(/installDeviceLabel\(/);
    expect(src).not.toMatch(/<input[^>]*type="text"/);
    expect(src).not.toMatch(/window\.prompt|prompt\(/);
    // the module Keycloak ships still does the WebAuthn ceremony
    expect(src).toMatch(/registerByWebAuthn/);
    expect(src).toMatch(/id="registerWebAuthn"/);
  });

  test('the page shell is one card with one h1 and a real submit button for "Try another way"', () => {
    const t = read('template.ftl');
    expect(t.match(/<main class="\$\{properties\.kcFormCardClass!\}">/g)).toHaveLength(1);
    expect(t.match(/<h1 /g)).toHaveLength(1);
    expect(t).toMatch(/<button type="submit" id="try-another-way"/);
    expect(t).not.toMatch(/onclick/);
    expect(t).toMatch(/role="<#if message\.type = 'error'/);
  });

  test('messages: English and Spanish define the same theme keys, MessageFormat-safe', () => {
    const parse = (f: string) =>
      Object.fromEntries(
        read(`messages/${f}`)
          .split('\n')
          .filter((l) => l.trim() && !l.startsWith('#'))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      ) as Record<string, string>;
    const en = parse('messages_en.properties');
    const es = parse('messages_es.properties');
    const used = new Set<string>();
    for (const file of templates) {
      for (const m of fs.readFileSync(file, 'utf-8').matchAll(/msg\("(jp[A-Za-z]+)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(8);
    for (const key of used) {
      expect(en, `en ${key}`).toHaveProperty(key);
      expect(es, `es ${key}`).toHaveProperty(key);
    }
    const jpKeys = (o: Record<string, string>) => Object.keys(o).filter((k) => k.startsWith('jp')).sort();
    expect(jpKeys(es)).toEqual(jpKeys(en));
    for (const [lang, msgs] of [['en', en], ['es', es]] as const) {
      for (const [key, value] of Object.entries(msgs)) {
        expect(value.trim(), `${lang} ${key} is empty`).not.toBe('');
        // Keycloak runs messages through MessageFormat: a lone apostrophe swallows what follows.
        expect(value.replace(/''/g, ''), `${lang} ${key}: apostrophe must be doubled`).not.toContain("'");
        expect([...value.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort(), `${lang} ${key} placeholders`).toEqual(
          [...(en[key] ?? value).matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort(),
        );
      }
    }
    // The credential failure messages stay identical (no lockout oracle, PROD-HARDENING.md).
    expect(new Set(['invalidUserMessage', 'invalidPasswordMessage', 'accountTemporarilyDisabledMessage', 'accountPermanentlyDisabledMessage'].map((k) => en[k])).size).toBe(1);
    expect(new Set(['invalidUserMessage', 'invalidPasswordMessage', 'accountTemporarilyDisabledMessage', 'accountPermanentlyDisabledMessage'].map((k) => es[k])).size).toBe(1);
  });
});

test.describe('theme CSS', () => {
  const frontendCss = fs.readFileSync(path.join(ROOT, 'frontend/src/styles/main.css'), 'utf-8');
  const block = (source: string, header: RegExp) => {
    const start = source.search(header);
    expect(start, `block ${header}`).toBeGreaterThanOrEqual(0);
    const open = source.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
    }
    throw new Error('unbalanced block');
  };
  const tokens = (body: string) => Object.fromEntries([...body.matchAll(/(--jp-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().replace(/\s+/g, ' ')]));

  const themeLight = tokens(block(css, /^:root\s*{/m));
  const themeDark = tokens(block(block(css, /@media \(prefers-color-scheme: dark\)/), /:root\s*{/));
  const appLight = tokens(block(frontendCss, /^:root\s*{/m));
  const appDark = tokens(block(frontendCss, /^\[data-theme="dark"\]\s*{/m));

  // Tokens that are copies of the app's. The others (--jp-field-border, --jp-success, --jp-warning,
  // --jp-radius, --jp-font) are deliberate: input edges and text colours tuned for contrast.
  const shared = [
    '--jp-bg', '--jp-surface', '--jp-surface-raised', '--jp-border', '--jp-border-strong',
    '--jp-text', '--jp-text-secondary', '--jp-text-tertiary',
    '--jp-accent', '--jp-accent-text', '--jp-accent-solid', '--jp-accent-solid-hover', '--jp-accent-subtle',
    '--jp-danger', '--jp-danger-subtle', '--jp-success-subtle', '--jp-radius', '--jp-white',
  ];

  test('design tokens are the app\'s tokens (light)', () => {
    for (const t of shared) expect(themeLight[t], `${t} (light)`).toBe(appLight[t]);
    expect(themeLight['--jp-font']).toBe(appLight['--jp-font']);
  });

  test('design tokens are the app\'s tokens (dark, by prefers-color-scheme)', () => {
    for (const t of shared.filter((x) => x in appDark)) expect(themeDark[t], `${t} (dark)`).toBe(appDark[t]);
  });

  test('every colour token the light theme defines is redefined for dark', () => {
    const colour = (k: string, v: string) => /^(#|rgba?\()/.test(v) && k !== '--jp-white';
    for (const [k, v] of Object.entries(themeLight)) {
      if (colour(k, v)) expect(themeDark, `${k} has a dark value`).toHaveProperty(k);
    }
  });

  test('controls are at least 44px tall (WCAG 2.5.8 target size, with margin)', () => {
    for (const selector of ['.jp-input', '.jp-btn', '.jp-input-group__toggle', '.jp-idp-exit', '.jp-user__change']) {
      const rule = css.match(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*{([^}]*)}`));
      expect(rule, selector).not.toBeNull();
      expect(rule![2], selector).toMatch(/min-height:\s*44px/);
    }
    expect(css).toMatch(/\.jp-input\s*{[^}]*font-size:\s*16px/); // iOS does not zoom
  });

  test('focus is always visible and animations respect reduced motion', () => {
    for (const selector of ['a:focus-visible', '.jp-btn:focus-visible', '.jp-input:focus-visible', '.jp-check__input:focus-visible']) {
      expect(css, selector).toContain(selector);
    }
    // outline is only ever removed where the same control gets another visible indicator
    for (const m of css.matchAll(/([^{}]+)\{[^}]*outline:\s*none/g)) {
      expect(m[1]!.trim(), 'outline: none').toMatch(/^(h1:focus|\.jp-input-group \.jp-input:focus-visible)$/);
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  test('no !important: the theme owns the page, nothing to override', () => {
    expect(css).not.toMatch(/!important/);
  });

  test('every url() points at a file that exists', () => {
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(8);
    for (const u of urls) expect(fs.existsSync(path.join(LOGIN, 'resources/css', u)), u).toBe(true);
    expect(fs.existsSync(path.join(LOGIN, 'resources/img/favicon.svg'))).toBe(true);
  });

  test('no unused CSS: every .jp-* class is set by a template, a theme property or a script', () => {
    const sources = [
      ...templates.map((f) => fs.readFileSync(f, 'utf-8')),
      themeProps,
      read('resources/js/jp-login.js'),
    ].join('\n');
    const classes = new Set([...css.matchAll(/\.(jp-[a-z0-9_-]+)/g)].map((m) => m[1]!));
    expect(classes.size).toBeGreaterThan(40);
    // jp-icon--* / jp-alert--* / jp-passkey-recovery--primary are composed or added by script
    const composed = [/^jp-alert--(error|warning|success|info)$/, /^jp-passkey-recovery--primary$/];
    for (const c of classes) {
      if (composed.some((re) => re.test(c))) continue;
      expect(sources.includes(c), `.${c} is in login.css but nothing sets it`).toBe(true);
    }
    // ...and the composed ones really are produced
    expect(read('template.ftl')).toMatch(/jp-alert--\$\{message\.type\}/);
    expect(read('resources/js/jp-login.js')).toMatch(/jp-passkey-recovery--primary/);
  });

  test('every jp-* class a template or property uses is styled', () => {
    const sources = [...templates.map((f) => fs.readFileSync(f, 'utf-8')), themeProps]
      .join('\n')
      .replace(/js\/jp-login\.js|data-jp-once/g, ''); // a script path and a data attribute, not classes
    const used = new Set([...sources.matchAll(/\bjp-[a-z0-9]+(?:(?:__|--|-)[a-z0-9]+)*/g)].map((m) => m[0]));
    const styled = new Set([...css.matchAll(/\.(jp-[a-z0-9_-]+)/g)].map((m) => m[1]!));
    // ids and message keys that merely start with jp-
    const notClasses = new Set([
      'jp-passkey-recovery-link', 'jp-error-action', 'jp-error-details', 'jp-error-original', // element ids
      'jp-passkey-error', 'jp-passkey-error-text', // element ids of webauthn-error.ftl
      'jp-passkey', 'jp-passkey-button', 'jp-passkey-continue', 'jp-passkey-other', 'jp-passkey-alt-status',
    ]);
    const unstyled = [...used].filter((c) => !notClasses.has(c) && !styled.has(c));
    expect(unstyled, 'classes set by a template or theme.properties with no rule in login.css').toEqual([]);
  });
});
