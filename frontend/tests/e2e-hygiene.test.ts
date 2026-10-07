// ARCH-07 guard: the Playwright suite (tests/e2e) must not regain fixed sleeps or
// silent skips. Sleeps hide races (and slow the suite); skips hide whole tests in CI.
// Use web-first assertions on a real readiness signal instead of waitForTimeout, and
// `test.fixme(condition, 'reason')` for a documented precondition instead of test.skip.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const ROOT = resolve(__dirname, '../..');
const E2E_DIR = join(ROOT, 'tests/e2e');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const RULES: Array<[string, RegExp]> = [
  ['waitForTimeout (fixed sleep)', /\bwaitForTimeout\s*\(/],
  ['test.skip( (use test.fixme(condition, reason) or remove the test)', /\btest\s*\.\s*skip\s*\(/],
  ['describe.skip( (whole block skipped)', /\bdescribe\s*\.\s*skip\s*\(/],
  ['test.fixme without a reason', /\btest\s*\.\s*fixme\s*\(\s*(true|false)?\s*\)/],
];

/** Every `file:line rule` violation in the given source. */
function violations(file: string, source: string): string[] {
  return source.split('\n').flatMap((line, i) =>
    RULES.filter(([, re]) => re.test(line)).map(([rule]) => `${file}:${i + 1} ${rule}`),
  );
}

describe('e2e hygiene (ARCH-07)', () => {
  const files = tsFiles(E2E_DIR);

  it('finds the Playwright specs', () => {
    expect(files.filter((f) => f.endsWith('.spec.ts')).length).toBeGreaterThan(20);
  });

  it('flags each banned pattern (scanner self-check)', () => {
    const sample = [
      'await page.waitForTimeout(500);',
      "test.skip(!ok, 'down');",
      'test.skip();',
      "test.describe.skip('x', () => {});",
      'test.fixme();',
      'test.fixme(true);',
      "test.fixme(!ok, 'needs the backend');", // allowed
      "expect(x).not.toMatch(/skip/);", // allowed
    ].join('\n');
    expect(violations('sample', sample).map((v) => v.split(' ')[0])).toEqual([
      'sample:1', 'sample:2', 'sample:3', 'sample:4', 'sample:5', 'sample:6',
    ]);
  });

  it('no spec or fixture uses a fixed sleep or an unconditional/silent skip', () => {
    const found = files.flatMap((f) => violations(relative(ROOT, f), readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
  });
});
