import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Owner report 2026-10-09 (real phone): the passkey error page printed Keycloak's raw English
 * sentence. webauthn-error.ftl turns the cases a person can act on into plain language (en, es).
 * No Keycloak and no browser needed; rendered pages: idp-theme-render.spec.ts, live: idp-passkey-labels.spec.ts.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-passkey-error-static --project=chromium
 */

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = path.join(ROOT, 'keycloak/themes/japan-trip/login');
const read = (file: string) => fs.readFileSync(path.join(LOGIN, file), 'utf-8');

test.describe('webauthn-error.ftl', () => {
  const error = read('webauthn-error.ftl');

  test("is the theme's page (the base one has an inline onclick and prints Keycloak's raw sentence)", () => {
    expect(error).toContain('<#import "template.ftl" as layout>');
    expect(error).not.toMatch(/onclick=/);
    expect(error).not.toMatch(/<script/);
  });

  test('sorts the three cases by the markers Keycloak and the browser really produce', () => {
    expect(error).toContain("jpSummary?contains('Device already exists with the same name')");
    expect(error).toContain("jpSummary?contains('InvalidStateError')");
    expect(error).toContain("jpSummary?contains('NotAllowedError')");
  });

  test('"Try again" posts what Keycloak\'s page posts: isSetRetry=retry and the execution', () => {
    expect(error).toMatch(/name="authenticationExecution" value="\$\{execution\}"/);
    expect(error).toMatch(/name="isSetRetry" value="retry"/);
    expect(error).toMatch(/<button type="submit" id="kc-try-again"/);
    expect(error).toMatch(/<#if isAppInitiatedAction\?\?>[\s\S]*id="cancelWebAuthnAIA" name="cancel-aia"/);
  });

  test('every Keycloak string printed raw goes through kcSanitize (SEC-11)', () => {
    const raw = [...error.matchAll(/\$\{([^}]*)\?no_esc\}/g)];
    expect(raw.length).toBeGreaterThan(0);
    for (const m of raw) expect(m[1], m[0]).toMatch(/kcSanitize\(/);
  });

  test('the friendly sentences exist in en and es and say what to do', () => {
    const en = read('messages/messages_en.properties');
    const es = read('messages/messages_es.properties');
    for (const key of ['jpPasskeyErrName', 'jpPasskeyErrDuplicate', 'jpPasskeyErrCancelled']) {
      expect(en, key).toMatch(new RegExp(`^${key}=.{30,}$`, 'm'));
      expect(es, key).toMatch(new RegExp(`^${key}=.{30,}$`, 'm'));
    }
    expect(en).toContain(
      'jpPasskeyErrDuplicate=This device already has a passkey for this account. You can use it to sign in, or add one from another device or password manager.',
    );
    expect(en).toMatch(/^jpPasskeyErrName=.*Try again/m);
    expect(es).toMatch(/^jpPasskeyErrName=.*Intentar otra vez/m);
  });
});
