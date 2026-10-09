import { expect, test } from '@playwright/test';
// Plain ES modules shipped as theme resources (and loaded by the browser on the login page);
// Playwright's loader transpiles them for these tests. No Keycloak, no browser.
import {
  MARKER_TTL_DAYS,
  MARKER_VERSION,
  MAX_MISSES,
  classifyCredentialError,
  createDeviceMemory,
  createTabGate,
  decideAutoPrompt,
  isFreshNavigation,
  markerKey,
  safeStorage,
  supportsImmediateMediation,
  tabIdOf,
} from '../../keycloak/themes/japan-trip/login/resources/js/passkey-device.js';
import {
  assertionToFields,
  base64UrlToBytes,
  buildRequestOptions,
  bytesToBase64Url,
  readServerParams,
} from '../../keycloak/themes/japan-trip/login/resources/js/passkey-webauthn.js';

/**
 * Pure logic of passkey-first sign-in (docs/design/PASSKEY-FIRST-LOGIN.md): the device
 * marker (set, read, expire, clear, corrupt values, storage that is off or throws), the
 * "may the page prompt by itself" decision, error classification, the per-tab gate and the
 * WebAuthn request/response translation.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-passkey-first-unit --project=chromium
 */

const DAY = 24 * 60 * 60 * 1000;

/** A Storage stand-in over a Map. `fail` makes chosen methods throw like a locked-down browser. */
function fakeStorage(fail: Partial<Record<'getItem' | 'setItem' | 'removeItem', Error>> = {}) {
  const map = new Map<string, string>();
  return {
    map,
    getItem(key: string) {
      if (fail.getItem) throw fail.getItem;
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (fail.setItem) throw fail.setItem;
      map.set(key, value);
    },
    removeItem(key: string) {
      if (fail.removeItem) throw fail.removeItem;
      map.delete(key);
    },
  };
}

/** A controllable clock. */
function clock(start = Date.UTC(2026, 9, 8, 12, 0, 0)) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms), set: (t: number) => (now = t) };
}

const REALM = 'japan-trip';

function memoryWith(raw: string | undefined, options: { realm?: string; ttlDays?: number } = {}) {
  const storage = fakeStorage();
  const c = clock();
  const memory = createDeviceMemory({ storage, now: c.now, realm: options.realm ?? REALM, ttlDays: options.ttlDays });
  if (raw !== undefined) storage.map.set(memory.key, raw);
  return { storage, memory, c };
}

test.describe('marker key', () => {
  const table: [string, unknown, string][] = [
    ['the realm name', 'japan-trip', 'jp.passkey.japan-trip'],
    ['a name with spaces and slashes', 'my realm/x', 'jp.passkey.my_realm_x'],
    ['an empty name', '', 'jp.passkey.default'],
    ['a blank name', '   ', 'jp.passkey.default'],
    ['no name', undefined, 'jp.passkey.default'],
    ['a name that is not a string', 42, 'jp.passkey.default'],
    ['dots, dashes and underscores stay', 'a.b-c_d', 'jp.passkey.a.b-c_d'],
    ['non-ASCII is replaced', 'ñandú', 'jp.passkey._and_'],
  ];
  for (const [name, input, expected] of table) {
    test(name, () => expect(markerKey(input as string)).toBe(expected));
  }
  test('very long names are cut at 64 characters', () => {
    expect(markerKey('x'.repeat(200))).toBe(`jp.passkey.${'x'.repeat(64)}`);
  });
  test('realms do not share a marker', () => {
    expect(markerKey('a')).not.toBe(markerKey('b'));
  });
});

test.describe('marker: set, read, clear', () => {
  test('no marker on a fresh browser', () => {
    const { memory } = memoryWith(undefined);
    expect(memory.read()).toBeNull();
    expect(memory.isActive()).toBe(false);
  });

  test('remember() stores a marker that read() returns', () => {
    const { memory, c } = memoryWith(undefined);
    expect(memory.remember()).toBe(true);
    expect(memory.read()).toEqual({ savedAt: c.now(), misses: 0 });
    expect(memory.isActive()).toBe(true);
  });

  test('the stored value is exactly {v, t, m}: nothing that says who', () => {
    const { memory, storage, c } = memoryWith(undefined);
    memory.remember();
    const raw = storage.map.get(memory.key)!;
    expect(JSON.parse(raw)).toEqual({ v: MARKER_VERSION, t: c.now(), m: 0 });
    expect([...storage.map.keys()]).toEqual([`jp.passkey.${REALM}`]);
    for (const value of Object.values(JSON.parse(raw))) expect(typeof value).toBe('number');
    // 13 digits of time, a version, a counter: no letters at all outside the field names
    expect(raw.replace(/"[vtm]"/g, '')).toMatch(/^[\d{}:,]+$/);
  });

  test('forget() removes it', () => {
    const { memory } = memoryWith(undefined);
    memory.remember();
    memory.forget();
    expect(memory.read()).toBeNull();
  });

  test('forget() on nothing is a no-op', () => {
    expect(() => memoryWith(undefined).memory.forget()).not.toThrow();
  });

  test('remember() again restarts the clock and the miss count', () => {
    const { memory, c } = memoryWith(undefined);
    memory.remember();
    memory.recordMiss();
    c.advance(5 * DAY);
    memory.remember();
    expect(memory.read()).toEqual({ savedAt: c.now(), misses: 0 });
  });

  test('two realms keep separate markers in one storage', () => {
    const storage = fakeStorage();
    const a = createDeviceMemory({ storage, realm: 'a' });
    const b = createDeviceMemory({ storage, realm: 'b' });
    a.remember();
    expect(a.isActive()).toBe(true);
    expect(b.isActive()).toBe(false);
  });
});

test.describe('marker: expiry', () => {
  test('the default lifetime is 180 days', () => {
    expect(MARKER_TTL_DAYS).toBe(180);
  });

  test('valid until the last millisecond of its lifetime, then gone and removed', () => {
    const { memory, storage, c } = memoryWith(undefined);
    memory.remember();
    c.advance(MARKER_TTL_DAYS * DAY);
    expect(memory.isActive()).toBe(true);
    c.advance(1);
    expect(memory.isActive()).toBe(false);
    expect(storage.map.has(memory.key)).toBe(false);
  });

  test('a shorter lifetime is honoured', () => {
    const { memory, c } = memoryWith(undefined, { ttlDays: 7 });
    memory.remember();
    c.advance(7 * DAY + 1);
    expect(memory.isActive()).toBe(false);
  });

  test('a miss does not extend the lifetime', () => {
    const { memory, c } = memoryWith(undefined);
    memory.remember();
    c.advance(100 * DAY);
    memory.recordMiss();
    c.advance(80 * DAY + 1);
    expect(memory.isActive()).toBe(false);
  });

  test('a marker from the future is tolerated up to a day (clock changes), not more', () => {
    const c = clock();
    const ok = memoryWith(JSON.stringify({ v: 1, t: c.now() + DAY, m: 0 }));
    expect(ok.memory.isActive()).toBe(true);
    const tooFar = memoryWith(JSON.stringify({ v: 1, t: c.now() + DAY + 60_000, m: 0 }));
    expect(tooFar.memory.isActive()).toBe(false);
  });
});

test.describe('marker: corrupt values are ignored and removed', () => {
  const bad: [string, string][] = [
    ['not JSON', 'not json'],
    ['empty string', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON number', '1'],
    ['a JSON string', '"passkey"'],
    ['an empty object', '{}'],
    ['a wrong version', JSON.stringify({ v: 2, t: Date.UTC(2026, 9, 8, 12), m: 0 })],
    ['a missing version', JSON.stringify({ t: Date.UTC(2026, 9, 8, 12), m: 0 })],
    ['a time that is a string', JSON.stringify({ v: 1, t: '1791460800000', m: 0 })],
    ['a time of null', JSON.stringify({ v: 1, t: null, m: 0 })],
    ['a missing time', JSON.stringify({ v: 1, m: 0 })],
    ['a negative miss count', JSON.stringify({ v: 1, t: Date.UTC(2026, 9, 8, 12), m: -1 })],
    ['a fractional miss count', JSON.stringify({ v: 1, t: Date.UTC(2026, 9, 8, 12), m: 0.5 })],
    ['a miss count at the limit', JSON.stringify({ v: 1, t: Date.UTC(2026, 9, 8, 12), m: MAX_MISSES })],
    ['a missing miss count', JSON.stringify({ v: 1, t: Date.UTC(2026, 9, 8, 12) })],
    ['an extra field (a user name, say)', JSON.stringify({ v: 1, t: Date.UTC(2026, 9, 8, 12), m: 0, user: 'a@b.c' })],
    ['truncated JSON', '{"v":1,"t":17'],
  ];
  for (const [name, raw] of bad) {
    test(name, () => {
      const { memory, storage } = memoryWith(raw);
      expect(memory.read()).toBeNull();
      expect(memory.isActive()).toBe(false);
      expect(storage.map.has(memory.key), 'the invalid marker is removed').toBe(false);
    });
  }

  test('a well-formed marker is accepted', () => {
    const { memory } = memoryWith(JSON.stringify({ v: 1, t: Date.UTC(2026, 9, 8, 12), m: 1 }));
    expect(memory.read()).toEqual({ savedAt: Date.UTC(2026, 9, 8, 12), misses: 1 });
  });
});

test.describe('marker: dismissed automatic prompts', () => {
  test('the limit is two in a row', () => {
    expect(MAX_MISSES).toBe(2);
  });

  test('the first miss keeps the marker, the second drops it', () => {
    const { memory, storage } = memoryWith(undefined);
    memory.remember();
    expect(memory.recordMiss()).toEqual({ dropped: false });
    expect(memory.read()?.misses).toBe(1);
    expect(memory.isActive()).toBe(true);
    expect(memory.recordMiss()).toEqual({ dropped: true });
    expect(memory.isActive()).toBe(false);
    expect(storage.map.has(memory.key)).toBe(false);
  });

  test('a miss without a marker reports dropped and stores nothing', () => {
    const { memory, storage } = memoryWith(undefined);
    expect(memory.recordMiss()).toEqual({ dropped: true });
    expect(storage.map.size).toBe(0);
  });

  test('a successful passkey sign-in in between resets the count', () => {
    const { memory } = memoryWith(undefined);
    memory.remember();
    memory.recordMiss();
    memory.remember(); // signed in with a passkey
    memory.recordMiss();
    expect(memory.isActive()).toBe(true);
  });
});

test.describe('storage that is off, locked down or failing (Safari private mode, blocked site data, quota)', () => {
  const securityError = new DOMException('The operation is insecure.', 'SecurityError');
  const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');

  test('no storage at all: nothing is remembered and nothing throws', () => {
    for (const storage of [null, undefined]) {
      const memory = createDeviceMemory({ storage: storage as never, realm: REALM });
      expect(memory.read()).toBeNull();
      expect(memory.isActive()).toBe(false);
      expect(memory.remember()).toBe(false);
      expect(() => memory.forget()).not.toThrow();
      expect(memory.recordMiss()).toEqual({ dropped: true });
    }
  });

  test('every method throwing (blocked cookies/site data): same as no storage', () => {
    const storage = fakeStorage({ getItem: securityError, setItem: securityError, removeItem: securityError });
    const memory = createDeviceMemory({ storage, realm: REALM });
    expect(memory.read()).toBeNull();
    expect(memory.remember()).toBe(false);
    expect(() => memory.forget()).not.toThrow();
    expect(memory.recordMiss()).toEqual({ dropped: true });
  });

  test('a full or write-protected storage: remember() says so, reading still works', () => {
    const storage = fakeStorage({ setItem: quota });
    const c = clock();
    const memory = createDeviceMemory({ storage, realm: REALM, now: c.now });
    storage.map.set(memory.key, JSON.stringify({ v: 1, t: c.now(), m: 0 }));
    expect(memory.remember()).toBe(false);
    expect(memory.isActive()).toBe(true); // the old marker is still readable
    expect(memory.recordMiss()).toEqual({ dropped: false }); // the write fails silently
  });

  test('a storage whose removeItem throws still answers read() with null for a bad value', () => {
    const storage = fakeStorage({ removeItem: securityError });
    storage.map.set(`jp.passkey.${REALM}`, 'garbage');
    const memory = createDeviceMemory({ storage, realm: REALM });
    expect(memory.read()).toBeNull();
  });

  test('getItem answering undefined or a non-string (odd polyfills) means no marker', () => {
    for (const answer of [undefined, 5, {}, true]) {
      const storage = { getItem: () => answer, setItem: () => {}, removeItem: () => {} };
      expect(createDeviceMemory({ storage: storage as never }).read()).toBeNull();
    }
  });

  test('safeStorage: a window whose localStorage getter throws (Chrome with cookies blocked) gives null', () => {
    const win = {};
    Object.defineProperty(win, 'localStorage', {
      get() {
        throw securityError;
      },
    });
    expect(safeStorage(win)).toBeNull();
  });

  test('safeStorage: missing, null or not-a-storage values give null', () => {
    expect(safeStorage({})).toBeNull();
    expect(safeStorage({ localStorage: null })).toBeNull();
    expect(safeStorage({ localStorage: {} })).toBeNull();
    expect(safeStorage(undefined)).toBeNull();
    expect(safeStorage(null)).toBeNull();
  });

  test('safeStorage: returns the storage when it is usable, and picks sessionStorage on request', () => {
    const local = fakeStorage();
    const session = fakeStorage();
    expect(safeStorage({ localStorage: local, sessionStorage: session })).toBe(local);
    expect(safeStorage({ localStorage: local, sessionStorage: session }, 'sessionStorage')).toBe(session);
  });

  test('Safari-like: script-written storage that disappears after seven days looks like a fresh browser, never an error', () => {
    // WebKit deletes script-writable storage after 7 days without interaction; the page then
    // simply finds no marker. (Interacting with the login page, which signing in does, restarts that clock.)
    const { memory, storage } = memoryWith(undefined);
    memory.remember();
    storage.map.clear(); // what the browser did
    expect(memory.read()).toBeNull();
    expect(memory.isActive()).toBe(false);
  });
});

test.describe('may the page start the passkey prompt by itself?', () => {
  const eligible = {
    serverAllows: true,
    topLevel: true,
    webauthn: true,
    markerActive: true,
    freshNavigation: true,
    alreadyPrompted: false,
    platformAuthenticator: true,
  };

  test('yes: plain sign-in page, top level, WebAuthn, marker, new navigation, first time, platform authenticator', () => {
    expect(decideAutoPrompt(eligible)).toEqual({ auto: true, reason: 'marker' });
  });

  const table: [string, Partial<typeof eligible>, string][] = [
    ['an error or notice is on the page', { serverAllows: false }, 'page-not-eligible'],
    ['inside an iframe', { topLevel: false }, 'framed'],
    ['no WebAuthn in the browser (passkey-only users recover by e-mail)', { webauthn: false }, 'no-webauthn'],
    ['no marker: the username form with autofill', { markerActive: false }, 'no-marker'],
    ['a reload or back/forward trip', { freshNavigation: false }, 'reload-or-history'],
    ['this login attempt already prompted once', { alreadyPrompted: true }, 'already-prompted'],
    ['no user-verifying platform authenticator', { platformAuthenticator: false }, 'no-platform-authenticator'],
  ];
  for (const [name, change, reason] of table) {
    test(`no: ${name}`, () => {
      expect(decideAutoPrompt({ ...eligible, ...change })).toEqual({ auto: false, reason });
    });
  }

  test('the first failing rule is the one reported', () => {
    expect(
      decideAutoPrompt({ ...eligible, serverAllows: false, topLevel: false, webauthn: false, markerActive: false }),
    ).toEqual({ auto: false, reason: 'page-not-eligible' });
    expect(decideAutoPrompt({ ...eligible, webauthn: false, markerActive: false })).toEqual({ auto: false, reason: 'no-webauthn' });
    expect(decideAutoPrompt({ ...eligible, alreadyPrompted: true, platformAuthenticator: false })).toEqual({
      auto: false,
      reason: 'already-prompted',
    });
  });

  test('freshNavigation defaults to true (a browser without the Navigation Timing API)', () => {
    const { freshNavigation: _omit, ...withoutIt } = eligible;
    expect(decideAutoPrompt(withoutIt).auto).toBe(true);
  });

  test('navigation types', () => {
    expect(isFreshNavigation('navigate')).toBe(true);
    expect(isFreshNavigation('prerender')).toBe(true);
    expect(isFreshNavigation(undefined)).toBe(true);
    expect(isFreshNavigation('reload')).toBe(false);
    expect(isFreshNavigation('back_forward')).toBe(false);
  });
});

test.describe('what a failed navigator.credentials.get() means', () => {
  const named = (name: string) => Object.assign(new Error(name), { name });
  const table: [unknown, string][] = [
    [named('NotAllowedError'), 'dismissed'],
    [named('AbortError'), 'dismissed'],
    [named('InvalidStateError'), 'dismissed'],
    [named('SecurityError'), 'blocked'],
    [named('NotSupportedError'), 'unsupported'],
    [named('TypeError'), 'failed'],
    [named('UnknownError'), 'failed'],
    [new Error('no name set'), 'failed'],
    [{ name: 42 }, 'failed'],
    ['NotAllowedError', 'failed'], // a bare string is not a DOMException
    [undefined, 'failed'],
    [null, 'failed'],
  ];
  for (const [error, expected] of table) {
    test(`${error instanceof Error ? error.name : JSON.stringify(error)} is ${expected}`, () => {
      expect(classifyCredentialError(error)).toBe(expected);
    });
  }
  test('a real DOMException is classified by name', () => {
    expect(classifyCredentialError(new DOMException('x', 'NotAllowedError'))).toBe('dismissed');
    expect(classifyCredentialError(new DOMException('x', 'SecurityError'))).toBe('blocked');
  });
});

test.describe('immediate mediation is opt-in by capability', () => {
  test('only an explicit true counts', () => {
    expect(supportsImmediateMediation({ immediateGet: true })).toBe(true);
    for (const caps of [undefined, null, {}, { immediateGet: false }, { immediateGet: 'true' }, { immediateGet: 1 }, 'immediateGet', 5]) {
      expect(supportsImmediateMediation(caps as never), JSON.stringify(caps)).toBe(false);
    }
  });
});

test.describe('the login attempt id', () => {
  test('is the tab_id of the URL', () => {
    expect(tabIdOf('http://localhost:8080/realms/r/login-actions/authenticate?session_code=a&execution=b&client_id=c&tab_id=XyZ-9_q&client_data=d')).toBe('XyZ-9_q');
  });
  test('is empty when there is none or the input is not a URL', () => {
    expect(tabIdOf('http://localhost:8080/realms/r/protocol/openid-connect/auth?client_id=c')).toBe('');
    expect(tabIdOf('')).toBe('');
    expect(tabIdOf(undefined as never)).toBe('');
    expect(tabIdOf(null as never)).toBe('');
    expect(tabIdOf(42 as never)).toBe('');
    expect(tabIdOf('http://[bad')).toBe('');
  });
  test('works on a relative form action too', () => {
    expect(tabIdOf('/realms/r/login-actions/authenticate?tab_id=abc')).toBe('abc');
  });
});

test.describe('one automatic prompt per login attempt', () => {
  test('the first claim wins, the same attempt cannot claim again, another attempt can', () => {
    const storage = fakeStorage();
    expect(createTabGate(storage, 'A').claimAutoPrompt()).toBe(true);
    expect(createTabGate(storage, 'A').claimAutoPrompt()).toBe(false); // reload of the same attempt
    expect(createTabGate(storage, 'A').hasPrompted()).toBe(true);
    expect(createTabGate(storage, 'B').hasPrompted()).toBe(false);
    expect(createTabGate(storage, 'B').claimAutoPrompt()).toBe(true);
  });

  test('without sessionStorage a page still prompts at most once per load', () => {
    const gate = createTabGate(null, 'A');
    expect(gate.hasPrompted()).toBe(false);
    expect(gate.claimAutoPrompt()).toBe(true);
    expect(gate.claimAutoPrompt()).toBe(false);
    expect(gate.hasPrompted()).toBe(true);
  });

  test('storage that throws behaves like no storage', () => {
    const boom = new DOMException('blocked', 'SecurityError');
    const gate = createTabGate(fakeStorage({ getItem: boom, setItem: boom, removeItem: boom }), 'A');
    expect(gate.claimAutoPrompt()).toBe(true);
    expect(gate.claimAutoPrompt()).toBe(false);
    expect(() => gate.markPending()).not.toThrow();
    expect(gate.wasPending()).toBe(false);
    expect(() => gate.clearPending()).not.toThrow();
  });

  test('an unknown attempt id is still a single attempt', () => {
    const storage = fakeStorage();
    expect(createTabGate(storage, '').claimAutoPrompt()).toBe(true);
    expect(createTabGate(storage, '').claimAutoPrompt()).toBe(false);
  });

  test('pending: a posted answer is remembered for the attempt only', () => {
    const storage = fakeStorage();
    const gate = createTabGate(storage, 'A');
    expect(gate.wasPending()).toBe(false);
    gate.markPending();
    expect(gate.wasPending()).toBe(true);
    expect(createTabGate(storage, 'B').wasPending()).toBe(false);
    gate.clearPending();
    expect(gate.wasPending()).toBe(false);
  });

  test('only attempt ids are kept in sessionStorage: nothing about the user', () => {
    const storage = fakeStorage();
    const gate = createTabGate(storage, 'tab123');
    gate.claimAutoPrompt();
    gate.markPending();
    expect([...storage.map.values()]).toEqual(['tab123', 'tab123']);
  });
});

test.describe('base64url', () => {
  const vectors: [number[], string][] = [
    [[], ''],
    [[0], 'AA'],
    [[255], '_w'],
    [[251, 255], '-_8'],
    [[1, 2, 3], 'AQID'],
    [[0xfb, 0xff, 0xbf], '-_-_'],
    [[104, 101, 108, 108, 111], 'aGVsbG8'],
  ];
  for (const [bytes, text] of vectors) {
    test(`${JSON.stringify(bytes)} <-> "${text}"`, () => {
      expect(bytesToBase64Url(Uint8Array.from(bytes))).toBe(text);
      expect([...base64UrlToBytes(text)]).toEqual(bytes);
    });
  }

  test('round trip of random data of every length from 0 to 70', () => {
    for (let n = 0; n <= 70; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n * 11) & 255);
      expect([...base64UrlToBytes(bytesToBase64Url(bytes))]).toEqual([...bytes]);
    }
  });

  test('accepts padded input and ArrayBuffers', () => {
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...base64UrlToBytes('AA==')]).toEqual([0]);
    expect(bytesToBase64Url(Uint8Array.from([1, 2, 3]).buffer)).toBe('AQID');
  });

  test('never emits padding or the + / alphabet', () => {
    const text = bytesToBase64Url(Uint8Array.from({ length: 255 }, (_, i) => i));
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('rejects text that is not base64url', () => {
    for (const bad of ['a+b', 'a/b', 'a b', 'é', 'a=b', '===', undefined, null, 5]) {
      expect(() => base64UrlToBytes(bad as never), String(bad)).toThrow();
    }
  });
});

test.describe('the values Keycloak rendered', () => {
  const dataset = { challenge: 'AQID_w', rpId: 'localhost', userVerification: 'required', timeout: '300' };

  test('are read into a request description', () => {
    expect(readServerParams(dataset)).toEqual({ challenge: 'AQID_w', rpId: 'localhost', userVerification: 'required', timeoutMs: 300000 });
  });

  test('no challenge, or one that is not base64url: the page stays a plain form (null)', () => {
    expect(readServerParams({})).toBeNull();
    expect(readServerParams({ ...dataset, challenge: '' })).toBeNull();
    expect(readServerParams({ ...dataset, challenge: 'a+b/c=' })).toBeNull();
    expect(readServerParams(undefined as never)).toBeNull();
    expect(readServerParams(null as never)).toBeNull();
  });

  test('"not specified" and unknown user verification values are left out (browser default)', () => {
    for (const uv of ['not specified', 'bogus', '', undefined]) {
      expect(readServerParams({ ...dataset, userVerification: uv })?.userVerification, String(uv)).toBeUndefined();
    }
    for (const uv of ['required', 'preferred', 'discouraged']) {
      expect(readServerParams({ ...dataset, userVerification: uv })?.userVerification).toBe(uv);
    }
  });

  test('a zero, negative, missing or garbled timeout means no timeout member', () => {
    for (const t of ['0', '-5', '', undefined, 'abc', 'NaN']) {
      expect(readServerParams({ ...dataset, timeout: t })?.timeoutMs, String(t)).toBeUndefined();
    }
    expect(readServerParams({ ...dataset, timeout: '1.5' })?.timeoutMs).toBe(1500);
  });

  test('a missing rp id is left out', () => {
    expect(readServerParams({ ...dataset, rpId: '' })?.rpId).toBeUndefined();
    expect(readServerParams({ ...dataset, rpId: '  ' })?.rpId).toBeUndefined();
  });
});

test.describe('the navigator.credentials.get() request', () => {
  const params = { challenge: 'AQID', rpId: 'localhost', userVerification: 'required', timeoutMs: 60000 };

  test('discoverable credentials: the challenge as bytes, no allowCredentials', () => {
    const options = buildRequestOptions(params);
    expect(options.publicKey.challenge).toBeInstanceOf(Uint8Array);
    expect([...options.publicKey.challenge]).toEqual([1, 2, 3]);
    expect(options.publicKey).toMatchObject({ rpId: 'localhost', userVerification: 'required', timeout: 60000 });
    expect(options.publicKey).not.toHaveProperty('allowCredentials');
    expect(options).not.toHaveProperty('mediation');
    expect(options).not.toHaveProperty('signal');
  });

  test('conditional mediation and an abort signal are passed through', () => {
    const controller = new AbortController();
    const options = buildRequestOptions(params, { mediation: 'conditional', signal: controller.signal });
    expect(options.mediation).toBe('conditional');
    expect(options.signal).toBe(controller.signal);
  });

  test('members that were not specified are not sent', () => {
    const options = buildRequestOptions({ challenge: 'AQID' });
    expect(Object.keys(options.publicKey)).toEqual(['challenge']);
  });

  test('a challenge that is not base64url throws instead of sending garbage', () => {
    expect(() => buildRequestOptions({ challenge: 'a+b' })).toThrow();
  });
});

test.describe('the hidden fields of the answer', () => {
  const buffer = (...bytes: number[]) => Uint8Array.from(bytes).buffer;
  const credential = (userHandle?: ArrayBuffer | null) => ({
    id: 'credIdBase64Url',
    response: {
      clientDataJSON: buffer(1),
      authenticatorData: buffer(2, 3),
      signature: buffer(4, 5, 6),
      userHandle,
    },
  });

  test('base64url of each part, the id as the browser gives it, the user handle when there is one', () => {
    expect(assertionToFields(credential(buffer(9, 8)) as never)).toEqual({
      clientDataJSON: 'AQ',
      authenticatorData: 'AgM',
      signature: 'BAUG',
      credentialId: 'credIdBase64Url',
      userHandle: 'CQg',
    });
  });

  test('no user handle, a null one or an empty one: the field is left out', () => {
    for (const handle of [undefined, null, new ArrayBuffer(0)]) {
      expect(assertionToFields(credential(handle) as never)).not.toHaveProperty('userHandle');
    }
  });
});
