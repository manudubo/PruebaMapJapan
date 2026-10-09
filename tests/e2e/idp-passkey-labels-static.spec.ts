import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_LABEL_LENGTH,
  buildPasskeyLabel,
  formatLabelStamp,
  installDeviceLabel,
  nextLabelSuffix,
  randomSuffix,
} from '../../keycloak/themes/japan-trip/login/resources/js/passkey-label.js';

/**
 * Owner report 2026-10-09 (real phone): a second passkey from the same device collided
 * ("Device already exists with the same name") because the label only carried the day. Labels now
 * carry the minute, then a counter or two random characters. No Keycloak, no browser needed.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-passkey-labels-static --project=chromium
 *
 * Live: idp-passkey-labels.spec.ts. Recovery link and error page: idp-passkey-recovery-static /
 * idp-passkey-error-static. Design note: docs/design/PASSKEY-FIRST-LOGIN.md.
 */

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = path.join(ROOT, 'keycloak/themes/japan-trip/login');
const read = (file: string) => fs.readFileSync(path.join(LOGIN, file), 'utf-8');

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MINUTE = new Date(2026, 9, 9, 14, 41, 5);
const NOW = new Date(2026, 9, 8, 13, 45);

const labelOf = (userAgent: string, extra: Record<string, unknown> = {}) =>
  buildPasskeyLabel({ userAgent, now: NOW, ...extra });

/** localStorage stand-in. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

/** A registration page: its form, its window, the label it ends up with. */
function pageFor(options: { storage?: unknown; at?: Date; retry?: boolean; random?: () => number }) {
  const submit: (() => void)[] = [];
  const fields: Record<string, { value: string }> = { '#authenticatorLabel': { value: '' }, '#error': { value: '' } };
  const form = {
    dataset: options.retry ? { retry: 'true' } : {},
    addEventListener: (_type: string, fn: () => void) => submit.push(fn),
    querySelector: (selector: string) => fields[selector] ?? null,
  };
  const win = { prompt: () => 'typed by a human' };
  const nav = { userAgent: CHROME_ANDROID, userAgentData: undefined, maxTouchPoints: 5 };
  const { label } = installDeviceLabel({
    form: form as never,
    window: win as never,
    navigator: nav as never,
    storage: options.storage as never,
    now: () => options.at ?? MINUTE,
    random: options.random,
  });
  return { label, prompt: () => win.prompt(), submit: () => submit.forEach((fn) => fn()), fields };
}

test.describe('unique passkey labels', () => {
  test('formatLabelStamp: date, space, 24-hour time; empty for anything that is not a valid Date', () => {
    expect(formatLabelStamp(new Date(2026, 9, 9, 0, 0))).toBe('2026-10-09 00:00');
    expect(formatLabelStamp(new Date(2026, 9, 9, 23, 59, 59))).toBe('2026-10-09 23:59');
    expect(formatLabelStamp(new Date(NaN))).toBe('');
    expect(formatLabelStamp(undefined as unknown as Date)).toBe('');
    expect(formatLabelStamp('2026-10-09 14:41' as unknown as Date)).toBe('');
  });

  test('nextLabelSuffix: the first in a minute has none, the next ones count, a new minute starts over', () => {
    const stamp = formatLabelStamp(MINUTE);
    const first = nextLabelSuffix({ stamp });
    expect(first.suffix).toBe('');
    expect(first.record).toEqual({ stamp, n: 1 });
    const second = nextLabelSuffix({ stamp, last: first.record });
    expect(second.suffix).toBe('2');
    expect(nextLabelSuffix({ stamp, last: second.record }).suffix).toBe('3');
    const later = nextLabelSuffix({ stamp: formatLabelStamp(new Date(2026, 9, 9, 14, 42)), last: second.record });
    expect(later.suffix).toBe('');
    expect(later.record.n).toBe(1);
  });

  test('nextLabelSuffix: a retry, a blocked storage or an unusable clock get random characters, not a counter', () => {
    const stamp = formatLabelStamp(MINUTE);
    const first = () => 0; // always the first letter of the alphabet
    expect(nextLabelSuffix({ stamp, retry: true, random: first }).suffix).toBe('aa');
    expect(nextLabelSuffix({ stamp, last: { stamp, n: 1 }, retry: true, random: first }).suffix).toBe('aa');
    expect(nextLabelSuffix({ stamp, storageKnown: false, random: first }).suffix).toBe('aa');
    expect(nextLabelSuffix({ stamp: '', random: first }).suffix).toBe('aa');
  });

  test('nextLabelSuffix ignores a corrupt memory instead of crashing', () => {
    const stamp = formatLabelStamp(MINUTE);
    const corrupt = [{ stamp, n: 0 }, { stamp, n: 1.5 }, { stamp, n: 'x' }, { stamp: 5, n: 1 }, {}, null, undefined];
    for (const last of corrupt) {
      expect(nextLabelSuffix({ stamp, last: last as never }).suffix, JSON.stringify(last)).toBe('');
    }
  });

  test('randomSuffix: two characters from a readable alphabet, whatever the random source returns', () => {
    for (const r of [0, 0.5, 0.999999, 1, 7, -0.3, NaN, Infinity, undefined as unknown as number]) {
      expect(randomSuffix(() => r), String(r)).toMatch(/^[a-hjkmnp-z2-9]{2}$/);
    }
    expect(randomSuffix()).toMatch(/^[a-hjkmnp-z2-9]{2}$/);
    expect(new Set(Array.from({ length: 200 }, () => randomSuffix())).size).toBeGreaterThan(50);
  });

  test('buildPasskeyLabel puts the suffix after the time and keeps it when the name is cut', () => {
    expect(labelOf(CHROME_ANDROID, { suffix: '2' })).toBe('Chrome on Android (2026-10-08 13:45 #2)');
    expect(labelOf(CHROME_ANDROID, { suffix: 'k7' })).toBe('Chrome on Android (2026-10-08 13:45 #k7)');
    const long = labelOf(SAFARI_IPHONE, { joiner: 'x'.repeat(500), suffix: 'k7' });
    expect(long.length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    expect(long.endsWith(' (2026-10-08 13:45 #k7)')).toBe(true);
    // without a usable clock the suffix is still there, so labels still differ
    expect(labelOf(SAFARI_IPHONE, { now: new Date(NaN), suffix: 'k7' })).toBe('Safari on iPhone (#k7)');
    // whitespace and control characters cannot split the suffix; length is capped
    expect(labelOf(SAFARI_IPHONE, { suffix: ' a\nb ' })).toBe('Safari on iPhone (2026-10-08 13:45 #ab)');
    expect(labelOf(SAFARI_IPHONE, { suffix: 'x'.repeat(100) }).length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
  });

  test('two passkeys on one device in the same minute get two different labels (the owner report)', () => {
    const storage = memoryStorage();
    const labels = [1, 2, 3].map(() => pageFor({ storage }).label());
    expect(labels).toEqual([
      'Chrome on Android (2026-10-09 14:41)',
      'Chrome on Android (2026-10-09 14:41 #2)',
      'Chrome on Android (2026-10-09 14:41 #3)',
    ]);
    expect(new Set(labels).size).toBe(3);
  });

  test('one page makes its label once: the prompt, the submit and label() agree', () => {
    const page = pageFor({ storage: memoryStorage() });
    const fromPrompt = page.prompt();
    page.submit();
    expect(page.fields['#authenticatorLabel']!.value).toBe(fromPrompt);
    expect(page.label()).toBe(fromPrompt);
  });

  test('a label is only remembered once it is used: an unused page does not burn a number', () => {
    const storage = memoryStorage();
    pageFor({ storage }); // opened, never clicked
    expect(storage.data.size).toBe(0);
    expect(pageFor({ storage }).label()).toBe('Chrome on Android (2026-10-09 14:41)');
  });

  test('"Try again" after a collision: the retry page never repeats the failed label, even if the memory is gone', () => {
    const failed = pageFor({ storage: memoryStorage() }).label();
    const retry = pageFor({ storage: memoryStorage(), retry: true, random: () => 0.5 }).label();
    expect(retry).not.toBe(failed);
    expect(retry).toMatch(/^Chrome on Android \(2026-10-09 14:41 #[a-z2-9]{2}\)$/);
  });

  test('blocked or broken storage: still a valid label, and two in a row still differ', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const sequence = [0.1, 0.2, 0.7, 0.9];
    let n = 0;
    const random = () => sequence[n++ % sequence.length]!;
    const a = pageFor({ storage: throwing, random }).label();
    const b = pageFor({ storage: throwing, random }).label();
    expect(a).toMatch(/^Chrome on Android \(2026-10-09 14:41 #[a-z2-9]{2}\)$/);
    expect(a).not.toBe(b);
    expect(pageFor({ storage: null }).label()).toMatch(/ #[a-z2-9]{2}\)$/); // no storage at all
  });

  test('garbage in the stored memory is ignored', () => {
    for (const raw of ['not json', '{', '[]', '123', '{"stamp":1,"n":1}', 'null']) {
      const storage = memoryStorage({ 'jp-passkey-label': raw });
      expect(pageFor({ storage }).label(), raw).toBe('Chrome on Android (2026-10-09 14:41)');
    }
  });

  test("a label always fits Keycloak's 255 characters, however many are made", () => {
    const storage = memoryStorage();
    expect(MAX_LABEL_LENGTH).toBeLessThanOrEqual(255);
    for (let i = 0; i < 30; i++) {
      expect(pageFor({ storage }).label().length).toBeLessThanOrEqual(MAX_LABEL_LENGTH);
    }
  });

  test('webauthn-register.ftl tells the script when the page is a retry', () => {
    expect(read('webauthn-register.ftl')).toMatch(/data-retry="\$\{isSetRetry\?has_content\?c\}"/);
  });
});
