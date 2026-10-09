import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Passkey-first sign-in, static checks of the theme files (no Keycloak, no browser):
 * the template contract the script relies on, CSP-friendliness (no inline script, no
 * handlers), privacy of what the scripts store, and what they must never do (cookies,
 * network, HTML injection).
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-passkey-first-static --project=chromium
 *
 * The behaviour is covered by idp-passkey-first-unit.spec.ts (pure logic),
 * idp-passkey-first-render.spec.ts (the states, rendered) and idp-passkey-first.spec.ts (live).
 */

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = path.join(ROOT, 'keycloak/themes/japan-trip/login');
const read = (file: string) => fs.readFileSync(path.join(LOGIN, file), 'utf-8');
const JS_FILES = ['passkey-device.js', 'passkey-webauthn.js', 'passkey-first.js'].map((f) => `resources/js/${f}`);

/** Source without comments and string-free of line comments, so prose cannot trip the checks. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

test.describe('passkey-first: templates', () => {
  const passkeys = read('passkeys.ftl');
  const username = read('login-username.ftl');
  const template = read('template.ftl');

  test('the theme replaces the base passkeys.ftl, and the username page uses both macros, panel before form', () => {
    expect(passkeys).toMatch(/<#macro conditionalUIData>/);
    expect(passkeys).toMatch(/<#macro firstPanel>/);
    expect(username).toMatch(/<#import "passkeys\.ftl" as passkeys>/);
    const panel = username.indexOf('<@passkeys.firstPanel />');
    const form = username.indexOf('<div id="kc-form">');
    const data = username.indexOf('<@passkeys.conditionalUIData />');
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(form);
    expect(data).toBeGreaterThan(form);
  });

  test('no inline script, no inline handler, no inline style: nothing for a strict CSP to block', () => {
    expect(passkeys).not.toMatch(/<script/i);
    expect(passkeys).not.toMatch(/\son[a-z]+\s*=/i);
    expect(passkeys).not.toMatch(/\sstyle\s*=/i);
  });

  test('the script is a same-origin module loaded by the shell on every login page', () => {
    expect(template).toMatch(/<script src="\$\{url\.resourcesPath\}\/js\/passkey-first\.js\?v=\$\{properties\.jpAssetVersion!\}" type="module"><\/script>/);
    expect(template).toMatch(/data-realm="\$\{\(realm\.name\)!''\}"/);
    expect(fs.existsSync(path.join(LOGIN, 'resources/js/passkey-first.js'))).toBe(true);
  });

  test('everything the script shows starts hidden: without JavaScript the page is the plain form', () => {
    for (const id of ['jp-passkey', 'jp-passkey-first', 'jp-passkey-alt']) {
      expect(passkeys, id).toMatch(new RegExp(`id="${id}"[^>]*\\shidden`));
    }
    // The form itself is never hidden by the server.
    expect(username).not.toMatch(/id="kc-form"[^>]*hidden/);
  });

  test('server values reach the script as data attributes, auto-prompt only on a message-free page', () => {
    for (const attr of ['data-realm', 'data-auto', 'data-challenge', 'data-rp-id', 'data-user-verification', 'data-timeout']) {
      expect(passkeys, attr).toContain(attr);
    }
    expect(passkeys).toMatch(/<#assign jpPasskeyAuto = !\(message\?has_content\) && !messagesPerField\.existsError\('username'\)>/);
    expect(passkeys).toMatch(/data-auto="\$\{jpPasskeyAuto\?c\}"/);
    expect(passkeys).toMatch(/data-timeout="\$\{createTimeout\?c\}"/);
    for (const key of ['Waiting', 'SigningIn', 'Dismissed', 'Failed', 'Unsupported']) {
      expect(passkeys, key).toContain(`msg("jpPasskey${key}")`);
    }
  });

  test('the base theme hidden form is kept (same ids Keycloak posts) and the buttons never submit by themselves', () => {
    expect(passkeys).toMatch(/<form id="webauth" action="\$\{url\.loginAction\}" method="post">/);
    for (const id of ['clientDataJSON', 'authenticatorData', 'signature', 'credentialId', 'userHandle', 'error']) {
      expect(passkeys, id).toMatch(new RegExp(`<input type="hidden" id="${id}" name="${id}"/>`));
    }
    for (const m of passkeys.matchAll(/<button\b[^>]*>/g)) expect(m[0], m[0]).toContain('type="button"');
  });

  test('status lines are polite live regions, announced and not focus-stealing', () => {
    expect(passkeys).toMatch(/id="jp-passkey-status"[^>]*role="status" aria-live="polite"/);
    expect(passkeys).toMatch(/id="jp-passkey-alt-status"[^>]*role="status" aria-live="polite"/);
    expect(passkeys).toMatch(/class="jp-passkey-hero" aria-hidden="true"/);
  });

  test('ids are unique inside the templates, and every id the script looks up exists', () => {
    const ids = [...passkeys.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(ids).size, `duplicate id in passkeys.ftl: ${ids}`).toBe(ids.length);
    const everything = [passkeys, username, template].join('\n');
    const js = read('resources/js/passkey-first.js');
    const wanted = new Set([
      ...[...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]!),
      ...[...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]!),
    ]);
    expect(wanted.size).toBeGreaterThan(12);
    // ids that other themes' pages provide only when their form is on the page
    const fromOtherPages = new Set(['register', 'attestationObject']);
    for (const id of wanted) {
      if (fromOtherPages.has(id)) continue;
      expect(everything, `id "${id}" used by passkey-first.js`).toMatch(new RegExp(`id="${id}"`));
    }
  });

  test('keeps the autofill token and a visible label on the e-mail field', () => {
    expect(username).toMatch(/enableWebAuthnConditionalUI\?has_content\)\?then\('username webauthn', 'username'\)/);
    expect(username).toMatch(/<label for="username"/);
  });

  test('buttons are real jp-btn controls (44px minimum comes from the shared rule)', () => {
    for (const id of ['jp-passkey-continue', 'jp-passkey-other', 'jp-passkey-button']) {
      expect(passkeys, id).toMatch(new RegExp(`id="${id}" class="\\$\\{properties\\.kcButtonClass!\\}`));
    }
  });
});

test.describe('passkey-first: scripts', () => {
  for (const file of JS_FILES) {
    test(`${path.basename(file)}: no cookies, no network, no HTML injection, no dynamic code`, () => {
      const src = code(file);
      expect(src).not.toMatch(/document\.cookie/);
      expect(src).not.toMatch(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/);
      expect(src).not.toMatch(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/);
      expect(src).not.toMatch(/\beval\s*\(|new Function\b|setTimeout\s*\(\s*['"`]/);
      expect(src).not.toMatch(/\bwindow\.(open|location\s*=)|location\.(href|assign|replace)\s*=/);
    });
  }

  test('the memory module knows nothing about who: no user name, e-mail, id or credential in its code', () => {
    const src = code('resources/js/passkey-device.js');
    expect(src).not.toMatch(/username|e-?mail|userId|user\.id|credentialId|userHandle|attemptedUsername/i);
    // one localStorage key per realm, the per-tab keys in sessionStorage only hold attempt ids
    expect([...src.matchAll(/'jp\.passkey\.[^']*'/g)].map((m) => m[0])).toEqual(["'jp.passkey.'", "'jp.passkey.auto-tab'", "'jp.passkey.pending-tab'"]);
  });

  test('the wiring writes text with textContent only, and never reads the user name field', () => {
    const src = code('resources/js/passkey-first.js');
    expect(src).toMatch(/el\.textContent = message/);
    expect(src).not.toMatch(/\.value\s*=\s*[^=]*username/i);
    // the e-mail field is only focused, never read
    expect([...src.matchAll(/usernameField\??\.(\w+)/g)].map((m) => m[1])).toEqual(['focus']);
  });

  test('the wiring is progressive: any failure puts the plain form back', () => {
    const src = read('resources/js/passkey-first.js');
    expect(src).toMatch(/catch \(error\) \{[\s\S]*revealForm\(doc\)/);
    expect(src).toMatch(/settle\(\)\.catch\(/);
  });

  test('the only module imports are the theme\'s own files, with extensions, and they exist', () => {
    for (const file of JS_FILES) {
      for (const m of read(file).matchAll(/from '(\.\/[^']+)'/g)) {
        expect(m[1], `${file} imports ${m[1]}`).toMatch(/^\.\/[a-z-]+\.js$/);
        expect(fs.existsSync(path.join(LOGIN, 'resources/js', m[1]!)), m[1]).toBe(true);
      }
      expect(read(file), file).not.toMatch(/from '[^.]/); // no bare specifiers: no import map needed
    }
  });

  test('the marker is set in exactly two places: a posted assertion and a posted enrolment', () => {
    const src = code('resources/js/passkey-first.js');
    expect([...src.matchAll(/memory\.remember\(\)/g)]).toHaveLength(2);
    expect(src).toMatch(/getElementById\('webauthn?'\)\?\.addEventListener\('submit'|getElementById\('webauth'\)\?\.addEventListener\('submit'/);
    expect(src).toMatch(/getElementById\('register'\)\?\.addEventListener\('submit'/);
    // ... and only when the answer holds a credential and no error
    expect(src).toMatch(/value\('credentialId'\) && !value\('error'\)/);
    expect(src).toMatch(/value\('attestationObject'\) && !value\('error'\)/);
  });

  test('"Use another account" clears the memory when that account signs in, not before', () => {
    const src = code('resources/js/passkey-first.js');
    expect(src).toMatch(/loginForm\?\.addEventListener\('submit', \(\) => \{\s*if \(otherChosen\) memory\.forget\(\);/);
  });
});

test.describe('passkey-first: styles and messages', () => {
  const css = read('resources/css/login.css');

  test('the hidden attribute beats component display rules, with no !important', () => {
    expect(css).toMatch(/html \[hidden\] \{ display: none; \}/);
    expect(css).not.toMatch(/!important/);
  });

  test('the panel, its status line and the alternative button are styled; the pulse respects reduced motion', () => {
    for (const selector of ['.jp-passkey-first', '.jp-passkey-lead', '.jp-passkey-status', '.jp-passkey-alt']) {
      expect(css, selector).toContain(selector);
    }
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.jp-passkey-first\[aria-busy="true"\] \.jp-passkey-hero \{ animation: none; \}/);
  });

  test('English and Spanish both say every passkey-first sentence, in each language\'s own words', () => {
    const parse = (f: string) =>
      Object.fromEntries(
        read(`messages/${f}`)
          .split('\n')
          .filter((l) => l.startsWith('jpPasskey'))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      ) as Record<string, string>;
    const en = parse('messages_en.properties');
    const es = parse('messages_es.properties');
    const keys = ['Lead', 'Waiting', 'SigningIn', 'Dismissed', 'Failed', 'Unsupported', 'Continue', 'Other', 'Button'].map((k) => `jpPasskey${k}`);
    for (const key of keys) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(es[key], `es ${key}`).toBeTruthy();
      expect(es[key], `${key} is translated`).not.toBe(en[key]);
      expect(en[key]).not.toMatch(/[<>&]/);
      expect(es[key]).not.toMatch(/[<>&]/);
    }
    // the sentences that tell the user what to do next always offer the e-mail way out
    for (const key of ['jpPasskeyDismissed', 'jpPasskeyFailed', 'jpPasskeyUnsupported']) {
      expect(en[key]).toMatch(/email/i);
      expect(es[key]).toMatch(/email/i);
    }
  });
});
