// Passkey labels come from the device, not from the user: "Chrome on Android (2026-10-08 13:45)".
//
// Keycloak refuses a second credential with the same label for a user ("Device already exists
// with the same name"), and the registration page is not told the labels that already exist.
// So the label carries the local minute, and when this browser already issued a label in the
// same minute (or the page is a retry after an error) it gets a short suffix: "... 13:45 #2"
// or "... 13:45 #k7".
//
// Keycloak's webauthnRegister.js asks the user for a label with window.prompt(); this module
// replaces that question (see installDeviceLabel and webauthn-register.ftl). The functions
// below are pure (no DOM, no globals) so tests/e2e/idp-theme-static.spec.ts can table-test them.

export const MAX_LABEL_LENGTH = 64;

const DEFAULT_JOINER = 'on';
const DEFAULT_FALLBACK = 'Passkey';

// Order matters: Edge, Opera, Samsung Internet, Vivaldi and the iOS wrappers all also say
// "Chrome" or "Safari" in their user agent.
const BROWSERS = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|OPiOS|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bVivaldi\//, 'Vivaldi'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bCriOS\/|(?:\b|Headless)Chrome\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\/|\bSafari\//, 'Safari'],
];

// iPhone/iPad before "Mac OS X" (iOS user agents say "like Mac OS X"); Android before Linux.
const SYSTEMS = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b|\bWin(?:32|64)\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bLinux\b|\bX11\b/, 'Linux'],
];

// navigator.userAgentData.brands: the browser's own brand wins; "Chromium" and the random
// "Not A;Brand" grease entries say nothing about which browser it is.
const UA_DATA_BROWSERS = [
  [/^Microsoft Edge$/i, 'Edge'],
  [/^Google Chrome$/i, 'Chrome'],
  [/^Opera$/i, 'Opera'],
  [/^Brave$/i, 'Brave'],
  [/^Vivaldi$/i, 'Vivaldi'],
  [/^Samsung Internet$/i, 'Samsung Internet'],
];

// A Map, not an object: a platform called "constructor" must not find Object.prototype.
const UA_DATA_SYSTEMS = new Map([
  ['android', 'Android'],
  ['windows', 'Windows'],
  ['macos', 'Mac'],
  ['chrome os', 'ChromeOS'],
  ['chromeos', 'ChromeOS'],
  ['linux', 'Linux'],
  ['ios', 'iPhone'],
]);

function firstMatch(table, text) {
  for (const [pattern, name] of table) {
    if (pattern.test(text)) return name;
  }
  return '';
}

function browserFromUaData(uaData) {
  const brands = (Array.isArray(uaData?.brands) ? uaData.brands : [])
    .map((entry) => (typeof entry?.brand === 'string' ? entry.brand.trim() : ''))
    .filter(Boolean);
  for (const brand of brands) {
    const named = firstMatch(UA_DATA_BROWSERS, brand);
    if (named) return named;
  }
  // Only "Chromium" (plus grease) left: a Chromium build that does not say who it is.
  return brands.some((brand) => /^Chromium$/i.test(brand)) ? 'Chrome' : '';
}

function systemFromUaData(uaData) {
  const platform = typeof uaData?.platform === 'string' ? uaData.platform.trim().toLowerCase() : '';
  return UA_DATA_SYSTEMS.get(platform) ?? '';
}

/**
 * Browser and operating system of the device, from the user agent string and, when the
 * browser has it, navigator.userAgentData (which wins: user agent strings are frozen or
 * reduced in Chromium and lie about the platform).
 *
 * @param {{ userAgent?: string, uaData?: { brands?: { brand: string }[], platform?: string, mobile?: boolean }, maxTouchPoints?: number }} [input]
 * @returns {{ browser: string, system: string }} empty strings when unknown
 */
export function detectDevice({ userAgent = '', uaData, maxTouchPoints = 0 } = {}) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  let system = systemFromUaData(uaData) || firstMatch(SYSTEMS, ua);
  // iPadOS 13+ sends a desktop Mac user agent; only the touch screen gives it away.
  if (system === 'Mac' && maxTouchPoints > 1) system = 'iPad';
  // "iOS" from userAgentData does not say which; the user agent string does.
  if (system === 'iPhone' && /\biPad\b/.test(ua)) system = 'iPad';
  const browser = browserFromUaData(uaData) || firstMatch(BROWSERS, ua);
  return { browser, system };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the device's local time, or '' for anything that is not a valid Date. */
export function formatLabelDate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return '';
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** YYYY-MM-DD HH:mm in the device's local time (the label's stamp), or '' for an invalid Date. */
export function formatLabelStamp(now) {
  const date = formatLabelDate(now);
  return date ? `${date} ${pad2(now.getHours())}:${pad2(now.getMinutes())}` : '';
}

// No 0/o/1/l/i: a person may have to read the label out of the account list.
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Two characters ("k7") picked with `random`, a function returning a number in [0, 1). */
export function randomSuffix(random = Math.random) {
  let out = '';
  for (let i = 0; i < 2; i++) {
    const r = Number(random());
    const index = Number.isFinite(r) ? Math.floor(Math.abs(r) * SUFFIX_ALPHABET.length) % SUFFIX_ALPHABET.length : 0;
    out += SUFFIX_ALPHABET[index];
  }
  return out;
}

/**
 * Which suffix keeps this label apart from the ones this browser already made.
 *  - same minute as the last label: a counter ("2", "3", ...);
 *  - a retry after an error (the collision may come from a label this browser does not know,
 *    e.g. another profile): two random characters;
 *  - no memory (storage blocked) or no usable clock: two random characters;
 *  - otherwise none.
 *
 * @param {{ stamp: string, last?: { stamp: string, n: number } | null, retry?: boolean, storageKnown?: boolean, random?: () => number }} input
 * @returns {{ suffix: string, record: { stamp: string, n: number } }} `record` is what to remember
 */
export function nextLabelSuffix({ stamp, last = null, retry = false, storageKnown = true, random = Math.random }) {
  const sameMinute = Boolean(stamp) && Boolean(last) && last.stamp === stamp && Number.isInteger(last.n) && last.n >= 1;
  const n = sameMinute ? last.n + 1 : 1;
  let suffix = '';
  if (retry || !storageKnown || !stamp) suffix = randomSuffix(random);
  else if (n > 1) suffix = String(n);
  return { suffix, record: { stamp, n } };
}

function clean(text) {
  // Control characters and bidi overrides have no business in a label; collapse whitespace.
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncate(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // high surrogate left dangling
  return text.slice(0, end).trimEnd();
}

/**
 * Label for a new passkey: "<browser> on <system> (<date> <time>[ #<suffix>])", e.g.
 * "Safari on iPhone (2026-10-08 13:45)". The local minute keeps passkeys from the same device
 * and browser apart in the account list; `suffix` separates two made in the same minute.
 * With only the system known it is "Passkey on Linux (<stamp>)", with only the browser
 * "Chrome (<stamp>)", with neither "Passkey (<stamp>)"; with no usable date the stamp is left
 * out (and the parentheses too, unless there is a suffix). Never empty, never longer than
 * `maxLength`.
 *
 * @param {object} [options]
 * @param {string} [options.userAgent]    navigator.userAgent
 * @param {object} [options.uaData]       navigator.userAgentData
 * @param {number} [options.maxTouchPoints] navigator.maxTouchPoints
 * @param {Date}   [options.now]          creation time (injected for tests)
 * @param {string} [options.suffix]       from nextLabelSuffix; at most 8 characters are kept
 * @param {string} [options.joiner]       translated "on"
 * @param {string} [options.fallback]     translated "Passkey"
 * @param {number} [options.maxLength]
 * @returns {string}
 */
export function buildPasskeyLabel({
  userAgent = '',
  uaData,
  maxTouchPoints = 0,
  now = new Date(),
  suffix: uniqueness = '',
  joiner = DEFAULT_JOINER,
  fallback = DEFAULT_FALLBACK,
  maxLength = MAX_LABEL_LENGTH,
} = {}) {
  const { browser, system } = detectDevice({ userAgent, uaData, maxTouchPoints });
  const on = clean(joiner) || DEFAULT_JOINER;
  const generic = clean(fallback) || DEFAULT_FALLBACK;
  let name;
  if (browser && system) name = `${browser} ${on} ${system}`;
  else if (browser) name = browser;
  else if (system) name = `${generic} ${on} ${system}`;
  else name = generic;

  const tag = clean(uniqueness).replace(/\s/g, '').slice(0, 8);
  const inner = [formatLabelStamp(now), tag ? `#${tag}` : ''].filter(Boolean).join(' ');
  const suffix = inner ? ` (${inner})` : '';
  const requested = Math.floor(Number(maxLength));
  const limit = requested >= 1 ? requested : MAX_LABEL_LENGTH;
  // The stamp and suffix are what make the label unique: shorten the name, not them.
  const room = Math.max(1, limit - suffix.length);
  const label = `${truncate(name, room)}${suffix}`;
  return truncate(label, limit) || DEFAULT_FALLBACK;
}

const STORAGE_KEY = 'jp-passkey-label';

/** The last label's record: { ok, last }. ok is false when the storage cannot even be read. */
function readLast(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    const valid = parsed && typeof parsed.stamp === 'string' && Number.isInteger(parsed.n) && parsed.n >= 1;
    return { ok: true, last: valid ? parsed : null };
  } catch (error) {
    // a SecurityError is a storage that is not there; bad JSON is a storage that holds rubbish
    return { ok: error instanceof SyntaxError, last: null };
  }
}

/** True when the record was stored. */
function writeLast(storage, record) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false; // blocked or full: the next label cannot count
  }
}

/**
 * Wire the device label into Keycloak's passkey registration page:
 *  - window.prompt answers with the generated label, so the user is never asked
 *    (webauthnRegister.js calls it right after navigator.credentials.create);
 *  - the hidden "authenticatorLabel" field is set again on submit, so a Keycloak that stops
 *    prompting still gets a label.
 * The label is made once per page, when first needed, and remembered (localStorage) so the next
 * one in the same minute differs. A form marked data-retry="true" (Keycloak's "Try again" after
 * an error, e.g. a name collision) always gets a fresh random suffix.
 *
 * @param {object} env
 * @param {HTMLFormElement} env.form          the #register form
 * @param {Window} env.window
 * @param {Navigator} env.navigator
 * @param {{ joiner?: string, fallback?: string }} [env.text]
 * @param {Storage | null} [env.storage]      defaults to window.localStorage (may be blocked)
 * @param {() => Date} [env.now]
 * @param {() => number} [env.random]
 * @returns {{ label: () => string }}
 */
export function installDeviceLabel({ form, window: win, navigator: nav, text = {}, storage, now = () => new Date(), random }) {
  let made = null;
  const label = () => {
    if (made !== null) return made;
    let store = storage;
    if (store === undefined) {
      try {
        store = win.localStorage;
      } catch {
        store = null;
      }
    }
    const when = now();
    const dice = random ?? (() => Math.random());
    const memory = store ? readLast(store) : { ok: false, last: null };
    const next = nextLabelSuffix({
      stamp: formatLabelStamp(when),
      last: memory.last,
      retry: form.dataset?.retry === 'true',
      storageKnown: memory.ok,
      random: dice,
    });
    // A memory that cannot be written is no memory: do not trust the counter's silence.
    let suffix = next.suffix;
    if (store && !writeLast(store, next.record) && !suffix) suffix = randomSuffix(dice);
    made = buildPasskeyLabel({
      userAgent: nav?.userAgent,
      uaData: nav?.userAgentData,
      maxTouchPoints: nav?.maxTouchPoints,
      now: when,
      suffix,
      joiner: text.joiner,
      fallback: text.fallback,
    });
    return made;
  };

  win.prompt = () => label();

  form.addEventListener('submit', () => {
    const field = form.querySelector('#authenticatorLabel');
    const failed = form.querySelector('#error')?.value;
    if (field && !failed) field.value = label();
  });

  return { label };
}
