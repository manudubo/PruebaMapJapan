import { describe, it, expect, beforeAll } from 'vitest';
import { search, buildSearchIndex } from '@/modules/search';

describe('search relevance', () => {
  beforeAll(() => buildSearchIndex());

  it('returns nothing for a query that matches no item (so the UI can show "No results")', () => {
    expect(search('qqqqzzzzxxxx')).toEqual([]);
    expect(search('<img src=x onerror=1>')).toEqual([]);
  });

  it('every result actually contains a query term (title, subtitle or city)', () => {
    for (const q of ['kyoto', 'fushimi', 'teamlab', 'amanek']) {
      const results = search(q);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        const hay = `${r.title} ${r.subtitle} ${r.city}`.toLowerCase();
        expect(hay).toContain(q);
      }
    }
  });

  it('is case-insensitive and ignores single-character noise', () => {
    expect(search('KYOTO').length).toBeGreaterThan(0);
    expect(search('a')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });
});
