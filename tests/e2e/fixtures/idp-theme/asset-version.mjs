// Cache-busting version of the login theme's static files.
//
//   node tests/e2e/fixtures/idp-theme/asset-version.mjs          prints the current version
//   node tests/e2e/fixtures/idp-theme/asset-version.mjs --write  stores it in theme.properties
//
// WHY: Keycloak serves theme files from /auth/resources/<version>/login/japan-trip/..., where
// <version> only changes with the Keycloak build, and in production (theme caching on) with
// "Cache-Control: max-age=2592000" (30 days). A browser that has seen css/login.css once keeps
// it for a month even after the theme is redeployed: that is how a phone showed the old
// stylesheet's nested boxes on the new markup. template.ftl therefore appends
// ?v=${properties.jpAssetVersion} to every stylesheet/script URL, and this version is the hash
// of every file under login/resources, so any edit changes the URL. idp-theme-cache.spec.ts
// fails when theme.properties is not up to date: run --write after editing a resource file.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../keycloak/themes/japan-trip/login');
const PROPS = path.join(LOGIN, 'theme.properties');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

export function computeAssetVersion() {
  const root = path.join(LOGIN, 'resources');
  const hash = crypto.createHash('sha256');
  for (const f of files(root).sort()) {
    hash.update(path.relative(root, f).split(path.sep).join('/')).update('\0').update(fs.readFileSync(f)).update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

export function recordedAssetVersion() {
  return /^jpAssetVersion=(\S*)$/m.exec(fs.readFileSync(PROPS, 'utf8'))?.[1] ?? null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = computeAssetVersion();
  if (process.argv.includes('--write')) {
    const src = fs.readFileSync(PROPS, 'utf8');
    const line = `jpAssetVersion=${v}`;
    const note = `$1\n\n# Cache-busting version of resources/ (see tests/e2e/fixtures/idp-theme/asset-version.mjs)\n${line}`;
    fs.writeFileSync(PROPS, /^jpAssetVersion=.*$/m.test(src) ? src.replace(/^jpAssetVersion=.*$/m, line) : src.replace(/^(meta=.*)$/m, note));
  }
  console.log(v);
}
