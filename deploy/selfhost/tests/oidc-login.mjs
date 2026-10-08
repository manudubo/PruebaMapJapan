#!/usr/bin/env node
/**
 * Headless OIDC login against the self-hosted Keycloak, then one API call
 * with the token: proves login page -> code -> token -> backend accepts it,
 * exactly the path the GitHub Pages frontend takes (authorization code +
 * PKCE, public client). No browser needed.
 *
 * Usage (env):
 *   PUBLIC_URL=https://host  KC_PATH=/auth  REALM=japan-trip
 *   CLIENT_ID=japan-trip-frontend  REDIRECT_URI=https://manudubo.github.io/PruebaMapJapan/dashboard.html
 *   ORIGIN=https://manudubo.github.io  USERNAME=...  PASSWORD=...
 *   API_URL=https://host/api   (default PUBLIC_URL/api)
 *   NODE_EXTRA_CA_CERTS=root.crt  for a test CA
 * Prints one JSON summary line; exit 0 only if the API accepted the token
 * (200/201) and refused a tampered copy (401).
 */
import { createHash, randomBytes } from 'node:crypto';

const env = process.env;
const PUBLIC_URL = env.PUBLIC_URL;
const KC = `${PUBLIC_URL}${env.KC_PATH ?? '/auth'}`;
const REALM = env.REALM ?? 'japan-trip';
const CLIENT_ID = env.CLIENT_ID ?? 'japan-trip-frontend';
const REDIRECT_URI = env.REDIRECT_URI ?? 'https://manudubo.github.io/PruebaMapJapan/dashboard.html';
const ORIGIN = env.ORIGIN ?? 'https://manudubo.github.io';
const API_URL = env.API_URL ?? `${PUBLIC_URL}/api`;

const jar = new Map();
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
}
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function req(url, init = {}) {
  const res = await fetch(url, {
    redirect: 'manual',
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: cookieHeader() },
  });
  storeCookies(res);
  return res;
}

function formAction(html) {
  const m = html.match(/<form[^>]*action="([^"]+)"/);
  if (!m) throw new Error(`no form in page: ${html.slice(0, 300)}`);
  return m[1].replace(/&amp;/g, '&');
}

const b64url = (buf) => buf.toString('base64url');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(12));

const authUrl = new URL(`${KC}/realms/${REALM}/protocol/openid-connect/auth`);
authUrl.search = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: 'openid',
  state,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}).toString();

let res = await req(authUrl);
if (res.status !== 200) throw new Error(`auth page: HTTP ${res.status} ${res.headers.get('location') ?? ''}`);
let html = await res.text();
const secureCookies = (res.headers.getSetCookie?.() ?? []).every((c) => /;\s*Secure/i.test(c));

// browser-passkey flow: username first, then (no passkey) the password form.
let location = null;
for (let step = 0; step < 4 && !location; step++) {
  const body = new URLSearchParams();
  if (/name="username"/.test(html)) body.set('username', env.USERNAME);
  if (/name="password"/.test(html)) body.set('password', env.PASSWORD);
  if (![...body.keys()].length) throw new Error(`unexpected page: ${html.match(/<title>[^<]*/)?.[0]}`);
  res = await req(formAction(html), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (res.status === 302) location = res.headers.get('location');
  else html = await res.text();
}
if (!location?.startsWith(REDIRECT_URI)) throw new Error(`login did not redirect to the app: ${location}`);
const back = new URL(location);
if (back.searchParams.get('state') !== state) throw new Error('state mismatch');
const code = back.searchParams.get('code');

res = await fetch(`${KC}/realms/${REALM}/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  }),
});
const tokenCors = res.headers.get('access-control-allow-origin');
const tokens = await res.json();
if (!tokens.access_token) throw new Error(`token exchange failed: ${JSON.stringify(tokens)}`);
if (env.TOKEN_FILE) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(env.TOKEN_FILE, tokens.access_token, { mode: 0o600 });
}
const claims = JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString());

res = await fetch(`${API_URL}/users/me`, {
  headers: { Authorization: `Bearer ${tokens.access_token}`, Origin: ORIGIN },
});
const apiStatus = res.status;
const apiCors = res.headers.get('access-control-allow-origin');
const apiBody = await res.text();

// A tampered token must be refused.
const parts = tokens.access_token.split('.');
const forged = `${parts[0]}.${Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' })).toString('base64url')}.${parts[2]}`;
const forgedStatus = (await fetch(`${API_URL}/users/me`, { headers: { Authorization: `Bearer ${forged}` } })).status;

console.log(
  JSON.stringify({
    secureCookies,
    issuer: claims.iss,
    aud: claims.aud,
    azp: claims.azp,
    tokenEndpointCors: tokenCors,
    apiStatus,
    apiCors,
    apiBody: apiBody.slice(0, 200),
    forgedStatus,
  }),
);
// /users/me answers 201 the first time it provisions the user, then 200.
process.exit((apiStatus === 200 || apiStatus === 201) && forgedStatus === 401 ? 0 : 1);
