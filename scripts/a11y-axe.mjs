// axe-core accessibility gate (DEP-03). Usage: node scripts/a11y-axe.mjs [baseUrl]
// Requires a running preview server and `axe-core` + `playwright` resolvable
// (CI: `npm i --no-save axe-core`; root devDependency @playwright/test provides playwright).
import { createRequire } from 'module';
import { readFileSync } from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const base = process.argv[2] ?? 'http://localhost:4173/PruebaMapJapan/';
const pages = ['index.html', 'tokyo.html', 'kyoto.html', 'dashboard.html', 'profile.html', 'trip.html'];
const FAIL_IMPACTS = new Set(['serious', 'critical']);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let failures = 0;
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ colorScheme: scheme });
  const page = await context.newPage();
  for (const name of pages) {
    await page.goto(base + name, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const res = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      return res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    });
    const blocking = violations.filter((v) => FAIL_IMPACTS.has(v.impact));
    console.log(`${scheme} ${name}: ${violations.length} violations, ${blocking.length} blocking`, JSON.stringify(violations));
    failures += blocking.length;
  }
  await context.close();
}
await browser.close();
if (failures > 0) {
  console.error(`axe: ${failures} serious/critical violation group(s)`);
  process.exit(1);
}
