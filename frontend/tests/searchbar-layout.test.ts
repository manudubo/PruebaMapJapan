// QA follow-up (finding 2): the search button was a fixed overlay (top:64px; right:12px) that
// covered page content on phones. Layout is only measurable in a real browser (see
// tests/e2e/qa-auth-resilience.spec.ts); these checks pin the CSS contract in jsdom.
import { describe, it, expect, beforeAll } from 'vitest';

let css = '';

beforeAll(async () => {
  await import('@/components/SearchBar');
  const el = document.createElement('search-bar');
  document.body.appendChild(el);
  css = el.shadowRoot?.querySelector('style')?.textContent ?? '';
});

/** Remove every @media block so we can inspect the base (narrow) rules alone. */
function withoutMedia(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('@media', i);
    if (at === -1) { out += text.slice(i); break; }
    out += text.slice(i, at);
    let depth = 0;
    let j = text.indexOf('{', at);
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

describe('SearchBar layout contract', () => {
  it('renders styles', () => {
    expect(css).toContain(':host');
  });

  it('is in normal flow below the wide breakpoint (never a fixed overlay on phones)', () => {
    expect(withoutMedia(css)).not.toMatch(/position:\s*fixed/);
  });

  it('only floats (fixed) when the viewport has a gutter beside the 1200px container', () => {
    const media = [...css.matchAll(/@media\s*\(min-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    expect(media.length).toBeGreaterThan(0);
    // 1200px container + 44px button + 16px offset + ~15px scrollbar + breathing room
    for (const w of media) expect(w).toBeGreaterThanOrEqual(1290);
    expect(css).not.toMatch(/@media\s*\(max-width/);
  });

  it('uses logical properties so RTL mirrors correctly', () => {
    const physical = css.match(/(^|[\s;{])(left|right):\s*\d/gm) ?? [];
    expect(physical).toEqual([]);
    expect(css).toMatch(/inset-inline-end/);
    expect(css).toMatch(/inset-inline-start/);
  });

  it('keeps the tap target at least 44x44', () => {
    expect(css).toMatch(/\.search-input\s*\{[^}]*height:\s*44px/);
    const w = /\.search-container\s*\{[^}]*width:\s*(\d+)px/.exec(css);
    expect(Number(w?.[1])).toBeGreaterThanOrEqual(46); // 44px + 1px border each side
  });

  it('keeps box styles off :host (the page universal reset zeroes :host padding)', () => {
    const host = /:host\s*\{([^}]*)\}/.exec(withoutMedia(css))?.[1] ?? '';
    expect(host).not.toMatch(/padding|margin/);
  });
});
