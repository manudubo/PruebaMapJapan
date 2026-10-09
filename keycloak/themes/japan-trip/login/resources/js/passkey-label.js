// Passkey labels come from the device, not from the user: "Chrome on Android (2026-10-08)".
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

/** YYYY-MM-DD in the device's local time, or '' for anything that is not a valid Date. */
export function formatLabelDate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
 * Label for a new passkey: "<browser> on <system> (<date>)", e.g. "Safari on iPhone (2026-10-08)".
 * The date keeps two passkeys from the same device and browser apart in the account list.
 * With only the system known it is "Passkey on Linux (<date>)", with only the browser
 * "Chrome (<date>)", with neither "Passkey (<date>)"; with no usable date, the date and its
 * parentheses are left out. Never empty, never longer than `maxLength`.
 *
 * @param {object} [options]
 * @param {string} [options.userAgent]    navigator.userAgent
 * @param {object} [options.uaData]       navigator.userAgentData
 * @param {number} [options.maxTouchPoints] navigator.maxTouchPoints
 * @param {Date}   [options.now]          creation time (injected for tests)
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

  const date = formatLabelDate(now);
  const suffix = date ? ` (${date})` : '';
  const requested = Math.floor(Number(maxLength));
  const limit = requested >= 1 ? requested : MAX_LABEL_LENGTH;
  // The date is the part that makes the label unique: shorten the name, not the date.
  const room = Math.max(1, limit - suffix.length);
  const label = `${truncate(name, room)}${suffix}`;
  return truncate(label, limit) || DEFAULT_FALLBACK;
}

/**
 * Wire the device label into Keycloak's passkey registration page:
 *  - window.prompt answers with the generated label, so the user is never asked
 *    (webauthnRegister.js calls it right after navigator.credentials.create);
 *  - the hidden "authenticatorLabel" field is set again on submit, so a Keycloak that stops
 *    prompting still gets a label.
 *
 * @param {object} env
 * @param {HTMLFormElement} env.form          the #register form
 * @param {Window} env.window
 * @param {Navigator} env.navigator
 * @param {{ joiner?: string, fallback?: string }} [env.text]
 * @returns {{ label: () => string }}
 */
export function installDeviceLabel({ form, window: win, navigator: nav, text = {} }) {
  const label = () =>
    buildPasskeyLabel({
      userAgent: nav?.userAgent,
      uaData: nav?.userAgentData,
      maxTouchPoints: nav?.maxTouchPoints,
      joiner: text.joiner,
      fallback: text.fallback,
    });

  win.prompt = () => label();

  form.addEventListener('submit', () => {
    const field = form.querySelector('#authenticatorLabel');
    const failed = form.querySelector('#error')?.value;
    if (field && !failed) field.value = label();
  });

  return { label };
}
