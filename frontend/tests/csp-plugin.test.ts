import { describe, it, expect, vi } from 'vitest';
import type { HtmlTagDescriptor } from 'vite';
import { buildCsp, cspOrigin, cspPlugin, CspConfigError, type CspTarget } from '../build/cspPlugin';

const STATIC_CONNECT =
  'https://api.allorigins.win https://corsproxy.io https://api.open-meteo.com https://nominatim.openstreetmap.org https://fonts.googleapis.com';

function directives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name!, sources.join(' ')];
    }),
  );
}

function runPlugin(env: Record<string, string | undefined>, command: 'build' | 'serve' = 'build') {
  const plugin = cspPlugin() as unknown as {
    configResolved: (c: unknown) => void;
    transformIndexHtml: () => HtmlTagDescriptor[];
  };
  const warn = vi.fn();
  plugin.configResolved({ command, env, logger: { warn } });
  return { tags: plugin.transformIndexHtml(), warn };
}

describe('buildCsp', () => {
  it('produces the exact production policy for https API + Keycloak', () => {
    expect(
      buildCsp({
        apiUrl: 'https://api.example.com/api',
        keycloakUrl: 'https://auth.example.com',
        target: 'build',
      }),
    ).toBe(
      [
        "default-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https://*.basemaps.cartocdn.com",
        `connect-src 'self' https://api.example.com https://auth.example.com ${STATIC_CONNECT}`,
        "font-src 'self' https://fonts.gstatic.com",
        "frame-src 'self' https://auth.example.com",
        "manifest-src 'self'",
        "worker-src 'self'",
      ].join('; '),
    );
  });

  it('allows the API origin in connect-src (regression: it used to be missing)', () => {
    const d = directives(buildCsp({ apiUrl: 'http://localhost:8787/api', keycloakUrl: 'http://localhost:8080', target: 'build' }));
    expect(d['connect-src']).toBe(`'self' http://localhost:8787 http://localhost:8080 ${STATIC_CONNECT}`);
    expect(d['frame-src']).toBe("'self' http://localhost:8080");
  });

  it('falls back to the same localhost defaults as the runtime when env is unset', () => {
    const d = directives(buildCsp({ apiUrl: undefined, keycloakUrl: undefined, target: 'build' }));
    expect(d['connect-src']).toContain('http://localhost:8787 http://localhost:8080 ');
  });

  it('adds nothing for an empty value (runtime then uses same-origin relative URLs)', () => {
    const d = directives(buildCsp({ apiUrl: '', keycloakUrl: '  ', target: 'build' }));
    expect(d['connect-src']).toBe(`'self' ${STATIC_CONNECT}`);
    expect(d['frame-src']).toBe("'self'");
  });

  it('de-duplicates when API and Keycloak share an origin', () => {
    const d = directives(buildCsp({ apiUrl: 'https://x.example.com/api', keycloakUrl: 'https://x.example.com/', target: 'build' }));
    expect(d['connect-src']).toBe(`'self' https://x.example.com ${STATIC_CONNECT}`);
  });

  it('never contains a bare wildcard source, blob:, unsafe-eval, or unpkg', () => {
    const csp = buildCsp({ apiUrl: 'https://api.example.com', keycloakUrl: 'https://auth.example.com', target: 'build' });
    for (const sources of Object.values(directives(csp))) {
      expect(sources.split(' ')).not.toContain('*');
      expect(sources).not.toMatch(/https?:(\s|$)/);
    }
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('blob:');
    expect(csp).not.toContain('unpkg.com');
  });
});

describe('cspOrigin', () => {
  const origin = (raw: string | undefined, target: CspTarget = 'build') =>
    cspOrigin('VITE_API_URL', raw, 'http://localhost:8787/api', target);

  it.each([
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com/api/', 'https://api.example.com'],
    ['https://api.example.com/v1/api?x=1#frag', 'https://api.example.com'],
    ['https://api.example.com:8443/api', 'https://api.example.com:8443'],
    ['https://API.Example.COM:443/api', 'https://api.example.com'],
    ['  https://api.example.com  ', 'https://api.example.com'],
    ['https://münchen.example/api', 'https://xn--mnchen-3ya.example'],
    ['https://203.0.113.7:8443/api', 'https://203.0.113.7:8443'],
    ['http://localhost:8787/api', 'http://localhost:8787'],
    ['http://127.0.0.1:8787/api', 'http://127.0.0.1:8787'],
    ['http://api.localhost:8787', 'http://api.localhost:8787'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(origin(raw)).toBe(expected);
  });

  it('returns null for empty/whitespace/root-relative values and the fallback origin when unset', () => {
    expect(origin('')).toBeNull();
    expect(origin('   ')).toBeNull();
    expect(origin('/api')).toBeNull();
    expect(origin(undefined)).toBe('http://localhost:8787');
  });

  it.each([
    ['not a url', /not an absolute URL/],
    ['*', /not an absolute URL/],
    ['api.example.com', /not an absolute URL/],
    ['//api.example.com/api', /not an absolute URL/],
    ['ftp://api.example.com', /http or https/],
    ['javascript:alert(1)', /http or https/],
    ['ws://api.example.com', /http or https/],
    ['https://*.example.com', /not a valid CSP host-source/],
    ['https://x.com;script-src', /not a valid CSP host-source/],
    ["https://x'y.com", /not a valid CSP host-source/],
    ['https://x"y.com', /not a valid CSP host-source/],
    ['https://a,b.com', /not a valid CSP host-source/],
    ['http://[::1]:8787/api', /IPv6/],
    ['https://[2001:db8::1]/api', /IPv6/],
  ])('rejects %s instead of emitting a broken or open policy', (raw, message) => {
    expect(() => origin(raw)).toThrow(CspConfigError);
    expect(() => origin(raw)).toThrow(message);
  });

  it('rejects credentials without echoing them', () => {
    expect(() => origin('https://user:s3cret@api.example.com/api')).toThrow(/must not contain credentials/);
    try {
      origin('https://user:s3cret@api.example.com/api');
    } catch (err) {
      expect((err as Error).message).not.toContain('s3cret');
    }
  });

  it('allows plain http to a non-loopback host only under the dev server', () => {
    expect(() => origin('http://api.example.com/api', 'build')).toThrow(/must use https/);
    expect(() => origin('http://192.168.1.20:8787/api', 'build')).toThrow(/must use https/);
    expect(origin('http://192.168.1.20:8787/api', 'serve')).toBe('http://192.168.1.20:8787');
  });
});

describe('cspPlugin', () => {
  it('reads the resolved Vite env and prepends one CSP meta tag', () => {
    const { tags, warn } = runPlugin({
      VITE_API_URL: 'https://api.example.com/api',
      VITE_KEYCLOAK_URL: 'https://auth.example.com',
    });
    expect(warn).not.toHaveBeenCalled();
    expect(tags).toHaveLength(1);
    expect(tags[0]!.tag).toBe('meta');
    expect(tags[0]!.injectTo).toBe('head-prepend');
    expect(tags[0]!.attrs!['http-equiv']).toBe('Content-Security-Policy');
    expect(directives(String(tags[0]!.attrs!['content']))['connect-src']).toContain('https://api.example.com');
  });

  it('warns on a production build with missing or empty env', () => {
    const { warn } = runPlugin({ VITE_API_URL: '' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]![0]).toMatch(/VITE_API_URL is empty/);
    expect(warn.mock.calls[1]![0]).toMatch(/VITE_KEYCLOAK_URL is unset/);
  });

  it('fails the build on a malformed URL rather than emitting a policy', () => {
    expect(() => runPlugin({ VITE_API_URL: 'https://*', VITE_KEYCLOAK_URL: 'https://auth.example.com' })).toThrow(CspConfigError);
  });

  it('accepts a LAN http API under the dev server', () => {
    const { tags } = runPlugin({ VITE_API_URL: 'http://192.168.1.20:8787/api', VITE_KEYCLOAK_URL: 'http://192.168.1.20:8080' }, 'serve');
    expect(String(tags[0]!.attrs!['content'])).toContain("connect-src 'self' http://192.168.1.20:8787 http://192.168.1.20:8080 ");
  });
});
