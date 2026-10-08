// recover.html follows the multi-page conventions: a Vite entry, the shared shell (skip link,
// navbar, landmark), the CSP meta via the plugin, and no secrets or third-party scripts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { gateSignupHtml } from '../build/signupGatePlugin';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

describe('recover.html', () => {
  const html = read('recover.html');

  it('is a Vite entry like the other app pages', () => {
    expect(read('vite.config.ts')).toMatch(/recover:\s*resolve\(__dirname, 'recover\.html'\)/);
    expect(html).toContain('<script type="module" src="/src/pages/recover.ts"></script>');
  });

  it('has the shared shell: lang, viewport, title, skip link, navbar, one main landmark', () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/name="viewport"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toContain('<a href="#main-content" class="skip-link">');
    expect(html).toContain('<travel-nav></travel-nav>');
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('id="recover-root"');
  });

  it('is kept out of search indexes and referrers (the email may be in the query string)', () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  it('has no inline script except the theme bootstrap, and no third-party script', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    const inline = scripts.filter((m) => !/\bsrc=/.test(m[1]!));
    expect(inline).toHaveLength(1);
    expect(inline[0]![2]).toContain("localStorage.getItem('theme')");
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });

  it('is not precached by the service worker (it needs the network)', () => {
    expect(read('public/sw.js')).not.toContain('recover.html');
  });

  it('is linked from the dashboard sign-in prompt, hidden in builds without accounts', () => {
    const dash = read('dashboard.html');
    expect(dash).toContain('id="auth-recover-link" href="recover.html"');
    const gated = gateSignupHtml(dash, false);
    expect(gated).toMatch(/<p class="login-prompt-help" hidden data-signup>/);
  });
});
