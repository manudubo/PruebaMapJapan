import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Owner report 2026-10-09 (real phone): the proactive "add a passkey" (signed in, kc_action) offered
 * "Can't use a passkey on this device? Get a code by email". footer.ftl hides it on app-initiated
 * actions. No Keycloak and no browser needed; the rendered pages are in idp-theme-render.spec.ts, the
 * live flow in idp-passkey-labels.spec.ts, the page x flow table in docs/design/PASSKEY-FIRST-LOGIN.md.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test idp-passkey-recovery-static --project=chromium
 */

const ROOT = path.resolve(__dirname, '../..');
const LOGIN = path.join(ROOT, 'keycloak/themes/japan-trip/login');
const read = (file: string) => fs.readFileSync(path.join(LOGIN, file), 'utf-8');

test.describe('recovery link only where it makes sense', () => {
  const footer = read('footer.ftl');

  test('footer.ftl: the link needs a passkey page AND not an app-initiated action', () => {
    expect(footer).toMatch(/<#assign jpAppInitiated = isAppInitiatedAction\?\?>/);
    expect(footer).toMatch(
      /<#if !jpAppInitiated && \(jpPage\?starts_with\('webauthn-authenticate'\) \|\| jpPage\?starts_with\('webauthn-register'\) \|\| jpPage\?starts_with\('webauthn-error'\)\)>/,
    );
    expect(footer).toContain('id="jp-passkey-recovery"');
    expect(footer).toContain('id="jp-passkey-recovery-link"');
  });

  test('footer.ftl: the way back to the app is outside the recovery block', () => {
    const recoveryEnd = footer.indexOf('</#if>', footer.indexOf('jp-passkey-recovery-link'));
    expect(footer.indexOf('jp-idp-exit')).toBeGreaterThan(recoveryEnd);
    expect(footer).toMatch(/<#if !\(jpErrorOwnsBack!false\)>\s*<a class="jp-idp-exit"/);
  });

  test('the recovery text exists in both languages', () => {
    for (const lang of ['en', 'es']) {
      expect(read(`messages/messages_${lang}.properties`)).toMatch(/^jpPasskeyRecovery=/m);
    }
  });
});

