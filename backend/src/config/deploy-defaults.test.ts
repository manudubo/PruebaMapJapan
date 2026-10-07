import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { APP_BASE_PATH, PAGES_ORIGIN } from './deploy-defaults';
import { PRODUCTION_ORIGINS } from '../middleware/cors';

const REPO = resolve(__dirname, '../../..');

/** Historical/audit documents that quote the old value on purpose. */
const HISTORICAL = new Set(['ANALISIS-REPO.md', 'codex-review.md']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.planning',
  'dist',
  '.terraform',
  'test-results',
  'playwright-report',
  '.claude',
]);
const TEXT_EXT = /\.(ts|js|mjs|cjs|json|tf|tfvars|example|md|html|yml|yaml|toml|sh|ftl|txt)$/;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (TEXT_EXT.test(name) || name.startsWith('.env')) yield p;
  }
}

// Built from parts so this file does not match its own check.
const TYPO = new RegExp(['manud', '(?!ubo)', '[.%/]'].join(''), 'i');

describe('Pages origin: single source of truth', () => {
  it('is a bare https origin of the owner account', () => {
    expect(PAGES_ORIGIN).toBe('https://manudubo.github.io');
    expect(new URL(PAGES_ORIGIN).origin).toBe(PAGES_ORIGIN);
    expect(APP_BASE_PATH).toBe('/PruebaMapJapan/');
  });

  it('vite base path matches APP_BASE_PATH', () => {
    const vite = readFileSync(join(REPO, 'frontend/vite.config.ts'), 'utf8');
    expect(vite).toContain(`base: '${APP_BASE_PATH}'`);
  });

  it('backend production CORS default comes from it', () => {
    expect(PRODUCTION_ORIGINS).toEqual([PAGES_ORIGIN]);
  });

  it('Terraform reads the same JSON file and hard-codes no github.io origin', () => {
    const dir = join(REPO, 'terraform/keycloak');
    const tf = readdirSync(dir)
      .filter((f) => f.endsWith('.tf'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(tf).toMatch(/config\/deploy-defaults\.json/);
    expect(tf).not.toMatch(/https:\/\/[a-z0-9-]+\.github\.io/);
  });

  it('regression: the misspelled Pages account appears nowhere outside historical docs', () => {
    const hits: string[] = [];
    for (const file of walk(REPO)) {
      const rel = relative(REPO, file);
      if (HISTORICAL.has(rel)) continue;
      if (TYPO.test(readFileSync(file, 'utf8'))) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });
});
