// QA follow-up (finding 1): every CSS custom property the app reads must be defined, and the
// theme tokens behind the landing countdown / primary buttons must keep WCAG AA contrast in
// light and dark. Undefined vars silently fell back to light hardcoded values in dark mode.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
const sources = [
  'src/styles/main.css',
  ...pages,
  ...walk('src').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')),
];
const all = sources.map((f) => ({ file: f, text: read(f) }));

const defined = new Set<string>();
for (const { text } of all) {
  // Declarations (`--x: …`) in any stylesheet, <style> block or inline style string.
  for (const m of text.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]!);
  // Runtime definitions via style.setProperty('--x', …).
  for (const m of text.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)['"]/g)) defined.add(m[1]!);
}

describe('CSS custom properties', () => {
  it('scans main.css, every page and every component', () => {
    expect(pages.length).toBeGreaterThanOrEqual(13);
    expect(sources.length).toBeGreaterThan(pages.length + 5);
  });

  it.each(sources)('%s only reads defined custom properties', (file) => {
    const text = read(file);
    const undefinedVars = [...text.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)]
      .map((m) => m[1]!)
      .filter((v) => !defined.has(v));
    expect([...new Set(undefinedVars)]).toEqual([]);
  });

  it('landing countdown colours come only from theme tokens (no hardcoded light colours)', () => {
    const index = read('index.html');
    expect(index).not.toMatch(/Countdown cards stay light/);
    const rules = [...index.matchAll(/\.(?:demo-countdown[\w-]*|countdown-[\w-]+)\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules.length).toBeGreaterThanOrEqual(5);
    for (const body of rules) expect(body).not.toMatch(/#[0-9a-f]{3,6}\b|rgb/i);
    expect(index).toMatch(/\.countdown-value\s*\{[^}]*color:\s*var\(--jp-text\)/);
  });
});

// ---------------------------------------------------------------------------
// Contrast of the token pairs the landing/dashboard rely on
// ---------------------------------------------------------------------------

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--jp-[a-z-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe('theme token contrast (WCAG AA 4.5:1)', () => {
  const css = read('src/styles/main.css');
  const light = block(css, ':root');
  const dark = { ...light, ...block(css, '[data-theme="dark"]') };
  const hexOr = (t: Record<string, string>, k: string): string => {
    const v = t[k];
    expect(v, k).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    return v!;
  };

  const pairs: Array<[string, string]> = [
    ['--jp-text', '--jp-surface'], // city card text
    ['--jp-text', '--jp-bg'], // countdown value on the page background
    ['--jp-text-secondary', '--jp-bg'], // countdown title / labels
    ['--jp-text-secondary', '--jp-surface'], // attribution text
    ['--jp-text-tertiary', '--jp-surface'], // city card dates
    ['--jp-text-tertiary', '--jp-bg'], // section titles on page bg
    ['--jp-white', '--jp-accent-solid'], // primary buttons / active tab
    ['--jp-white', '--jp-accent-solid-hover'],
  ];

  for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
    it.each(pairs)(`${name}: %s on %s`, (fg, bg) => {
      expect(contrast(hexOr(theme, fg), hexOr(theme, bg))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('dark cards are actually dark (the reported bug)', () => {
    expect(luminance(hexOr(dark, '--jp-surface'))).toBeLessThan(0.05);
  });
});
