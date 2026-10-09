// Regenerates the HTML snapshots idp-theme-render.spec.ts renders (real Keycloak output).
//
//   KEYCLOAK_URL=http://localhost:8080 KC_ADMIN_PASSWORD=... node tests/e2e/fixtures/idp-theme/capture.mjs
//
// Needs a Keycloak with the japan-trip realm (scripts/ci/keycloak-flow.sh) whose login theme is
// this checkout's keycloak/themes/japan-trip, registration open, and the master admin password
// (read from KC_ADMIN_PASSWORD or the file in KC_MASTER_ADMIN_PASSWORD_FILE). It creates
// throwaway users and deletes them again. Snapshots are scrubbed: scripts removed, session
// codes, tab ids and the throwaway e-mail replaced, resource URLs rewritten to /resources/.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const KC = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'japan-trip';
const OUT = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PW =
  process.env.KC_ADMIN_PASSWORD ?? fs.readFileSync(process.env.KC_MASTER_ADMIN_PASSWORD_FILE ?? '', 'utf8').trim();
const PW = `Aa1!${crypto.randomBytes(12).toString('base64url')}`;
const AUTH =
  `${KC}/realms/${REALM}/protocol/openid-connect/auth?client_id=japan-trip-frontend` +
  '&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2FPruebaMapJapan%2Fdashboard.html&response_type=code&scope=openid' +
  '&ui_locales=en&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256';

const tok = await (
  await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'admin-cli', grant_type: 'password', username: 'admin', password: ADMIN_PW }),
  })
).json();
const admin = (method, p, body) =>
  fetch(`${KC}/admin/realms/${REALM}${p}`, {
    method,
    headers: { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
const created = [];
async function mkUser(label, requiredActions = []) {
  const email = `theme-${label}-${crypto.randomBytes(3).toString('hex')}@example.test`;
  await admin('POST', '/users', {
    username: email, email, enabled: true, emailVerified: true, firstName: 'Test', lastName: 'User', requiredActions,
    credentials: [{ type: 'password', value: PW, temporary: false }],
  });
  created.push(email);
  // Keycloak adds the realm's default required actions (create a passkey) to a new user, and
  // that step would come before the one a snapshot is about to show: set exactly the wanted ones.
  const [user] = await (await admin('GET', `/users?username=${encodeURIComponent(email)}&exact=true`)).json();
  await admin('PUT', `/users/${user.id}`, { requiredActions });
  return email;
}

const browser = await chromium.launch();
const snaps = [];
async function snap(page, name, served) {
  await page.waitForLoadState('domcontentloaded');
  let html = served ?? (await page.content());
  html = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/(session_code|tab_id|execution|client_data|kc_locale)=[^&"'\s]+/g, '$1=x')
    .replace(/\/resources\/[^/]+\/(login|common)\//g, '/resources/$1/')
    .replace(/theme-[a-z-]+-[0-9a-f]{6}@example\.test/g, 'traveler@example.test')
    .replace(/http:\/\/localhost:8080/g, '');
  fs.writeFileSync(path.join(OUT, `${name}.html`), html);
  snaps.push(name);
}
async function ctx() {
  const c = await browser.newContext({ locale: 'en-US' });
  return { c, p: await c.newPage() };
}
async function toPasswordStep(p, email) {
  await p.goto(AUTH);
  await p.fill('#username', email);
  await p.click('#kc-login');
  await p.waitForSelector('#password');
}

try {
  let { c, p } = await ctx();
  const served = await (await p.goto(AUTH)).text(); // the server's HTML: the theme script has not touched it
  await snap(p, 'username', served);
  await p.click('#kc-registration a');
  await snap(p, 'register');
  await c.close();

  const email = await mkUser('pw');
  ({ c, p } = await ctx());
  await toPasswordStep(p, email);
  await p.fill('#password', 'wrong-password');
  await p.click('#kc-login');
  await p.waitForSelector('#input-error-password');
  await snap(p, 'password-error');
  await c.close();

  const passkey = await mkUser('pk', ['webauthn-register-passwordless']);
  ({ c, p } = await ctx());
  await toPasswordStep(p, passkey);
  await p.fill('#password', PW);
  await p.click('#kc-login');
  await p.waitForSelector('#registerWebAuthn');
  await snap(p, 'webauthn-register');
  await c.close();

  const upd = await mkUser('upd', ['UPDATE_PASSWORD']);
  ({ c, p } = await ctx());
  await toPasswordStep(p, upd);
  await p.fill('#password', PW);
  await p.click('#kc-login');
  await p.waitForSelector('#password-new');
  await p.fill('#password-new', 'a');
  await p.fill('#password-confirm', 'b');
  await p.click('#kc-passwd-update-form [type=submit]');
  await snap(p, 'update-password-error');
  await c.close();

  ({ c, p } = await ctx());
  await p.goto(AUTH.replace('redirect_uri=http', 'redirect_uri=https%3A%2F%2Fevil.example%2F&x=http'));
  await snap(p, 'error');
  await c.close();

} finally {
  for (const email of created) {
    const users = await (await admin('GET', `/users?username=${encodeURIComponent(email)}&exact=true`)).json();
    for (const u of users) await admin('DELETE', `/users/${u.id}`);
  }
  await browser.close();
}
console.log('captured', snaps.join(', '));
