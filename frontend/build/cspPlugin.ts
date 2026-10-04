import type { HtmlTagDescriptor, Plugin } from 'vite';

// SEC-04: Content-Security-Policy injected as a <meta> into every HTML entry.
//
// The API and Keycloak origins are build-time configuration (VITE_API_URL,
// VITE_KEYCLOAK_URL), so the policy is derived from the same resolved env that
// Vite bakes into `import.meta.env`. Before this, only Keycloak (read from
// process.env, ignoring .env files) was allowed and every API fetch was blocked
// by connect-src in any browser that enforced the policy.
//
// Every env-derived source is validated and reduced to a bare origin. Anything
// that is not a plain http(s) origin with a DNS/IPv4 host fails the build rather
// than producing a broken or wildcard (`*`) policy.

/** Runtime fallbacks; must match src/api/client.ts and src/auth/keycloak.ts. */
export const DEFAULT_API_URL = 'http://localhost:8787/api';
export const DEFAULT_KEYCLOAK_URL = 'http://localhost:8080';

/** Third-party origins the app itself fetches (see src/modules/*). */
const CONNECT_SRC_STATIC = [
  'https://api.allorigins.win', // widgets.ts news RSS proxy
  'https://corsproxy.io', // widgets.ts news RSS proxy fallback
  'https://api.open-meteo.com', // widgets.ts weather
  'https://nominatim.openstreetmap.org', // geocoder.ts
  'https://fonts.googleapis.com', // <link rel="preconnect">
];

const IMG_SRC_STATIC = [
  // data: carries Leaflet's control/marker images, which Vite inlines from leaflet.css.
  'data:',
  'https://*.basemaps.cartocdn.com', // theme.ts map tiles
];

export type CspTarget = 'serve' | 'build';

export interface CspInput {
  /** Raw VITE_API_URL (undefined = unset, falls back like the runtime does). */
  apiUrl: string | undefined;
  /** Raw VITE_KEYCLOAK_URL. */
  keycloakUrl: string | undefined;
  /** `serve` (vite dev) tolerates plain http to any host; `build` only to loopback. */
  target: CspTarget;
}

export class CspConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CspConfigError';
  }
}

// One DNS label: letters/digits/hyphen, no leading/trailing hyphen. IPv4 literals
// match too. Deliberately excludes `*`, `;`, `,`, quotes and `[` — WHATWG URL
// accepts several of those in a host, and any of them would widen or corrupt
// the policy.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Reduce a configured URL to a CSP host-source (scheme://host[:port]).
 * Returns null when the value is empty or a root-relative path: the runtime then
 * uses same-origin URLs, which 'self' already covers.
 */
export function cspOrigin(name: string, raw: string | undefined, fallback: string, target: CspTarget): string | null {
  const value = raw === undefined ? fallback : raw.trim();
  // A root-relative path ("/api") is fetched same-origin; "//host" is not, so it
  // falls through to the absolute-URL check and is rejected.
  if (value === '' || (value.startsWith('/') && !value.startsWith('//'))) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CspConfigError(`${name}="${value}" is not an absolute URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CspConfigError(`${name}="${value}" must use http or https`);
  }
  if (url.username || url.password) {
    // The value is also baked into the JS bundle: credentials here would ship to every visitor.
    throw new CspConfigError(`${name} must not contain credentials`);
  }
  if (url.hostname.startsWith('[')) {
    // CSP host-source grammar has no IPv6 literal form; browsers drop such a source.
    throw new CspConfigError(`${name}="${value}": IPv6 literal hosts cannot be expressed in CSP, use a hostname`);
  }
  if (!HOST_RE.test(url.hostname)) {
    throw new CspConfigError(`${name}="${value}" has a host that is not a valid CSP host-source`);
  }
  if (target === 'build' && url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new CspConfigError(`${name}="${value}" must use https in a production build (http is only allowed for localhost)`);
  }
  return url.origin;
}

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))];
}

export function buildCsp({ apiUrl, keycloakUrl, target }: CspInput): string {
  const api = cspOrigin('VITE_API_URL', apiUrl, DEFAULT_API_URL, target);
  const keycloak = cspOrigin('VITE_KEYCLOAK_URL', keycloakUrl, DEFAULT_KEYCLOAK_URL, target);

  return [
    "default-src 'none'",
    // 'unsafe-inline' is the accepted Phase 20 trade-off for the inline FOUC scripts (T-20-03-02).
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src ${unique(["'self'", ...IMG_SRC_STATIC]).join(' ')}`,
    `connect-src ${unique(["'self'", api, keycloak, ...CONNECT_SRC_STATIC]).join(' ')}`,
    "font-src 'self' https://fonts.gstatic.com",
    // 'self' = silent-check-sso.html; Keycloak = its 3p-cookies check iframe.
    `frame-src ${unique(["'self'", keycloak]).join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    // No <base> may re-point relative URLs, and forms may only submit to this
    // origin: sanitised user notes can still contain a <form> (review N6).
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/** Opt-out for a deliberately backend-less (demo-only) production build. */
export const ALLOW_MISSING_ENV = 'CSP_ALLOW_MISSING_ORIGINS';

/**
 * Review N6: a production build without VITE_API_URL / VITE_KEYCLOAK_URL used
 * to warn and ship a CSP that allows localhost and blocks the real API. Unset
 * GitHub secrets expand to "", so empty counts as missing too. A root-relative
 * URL ("/api") is an explicit same-origin choice and is fine.
 *
 * Missing both is allowed only with CSP_ALLOW_MISSING_ORIGINS=true (exactly),
 * from the Vite env or process.env: the demo-only GitHub Pages deploy. Missing
 * one of the two is always a misconfiguration.
 */
export function checkProductionOrigins(
  env: Record<string, string | undefined>,
  warn: (msg: string) => void,
): void {
  const names = ['VITE_API_URL', 'VITE_KEYCLOAK_URL'] as const;
  const missing = names.filter((n) => !env[n]?.trim());
  if (missing.length === 0) return;

  const optOut = (env[ALLOW_MISSING_ENV] ?? process.env[ALLOW_MISSING_ENV]) === 'true';
  if (missing.length === 1) {
    throw new CspConfigError(
      `${missing[0]} is not set but ${names.find((n) => !missing.includes(n))} is: only one of the two origins ` +
        `is configured, so the CSP would block the other in production. Set both.`,
    );
  }
  if (!optOut) {
    throw new CspConfigError(
      'VITE_API_URL and VITE_KEYCLOAK_URL are not set for a production build, so the CSP would only allow ' +
        `localhost. Set them, or set ${ALLOW_MISSING_ENV}=true for a deliberately demo-only build.`,
    );
  }
  warn(
    `[csp-meta] demo-only build (${ALLOW_MISSING_ENV}=true): VITE_API_URL and VITE_KEYCLOAK_URL are not set; ` +
      'the CSP uses the localhost defaults.',
  );
}

export function cspPlugin(): Plugin {
  let csp = '';
  return {
    name: 'csp-meta',
    configResolved(config) {
      // config.env is exactly what import.meta.env exposes to the bundle
      // (.env files + process.env), so the policy cannot drift from the code.
      const env = config.env as Record<string, string | undefined>;
      const target: CspTarget = config.command === 'build' ? 'build' : 'serve';
      if (target === 'build') checkProductionOrigins(env, config.logger.warn.bind(config.logger));
      csp = buildCsp({ apiUrl: env['VITE_API_URL'], keycloakUrl: env['VITE_KEYCLOAK_URL'], target });
    },
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
          // First in <head> so it governs every inline script and stylesheet after it.
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
