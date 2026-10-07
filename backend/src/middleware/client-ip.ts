import type { Context } from 'hono';
import { log } from '../observability/logger';

/**
 * Client IP for rate limiting, with forwarding headers trusted ONLY as far as
 * the operator says there are proxies in front of us.
 *
 *  TRUSTED_PROXY_HOPS (integer, default 0)
 *    0  ignore every forwarding header; use the TCP peer address
 *       (Node: `c.env.incoming.socket.remoteAddress`, as passed by
 *       @hono/node-server). A client-supplied X-Forwarded-For is never read.
 *    N  N proxies we control sit in front of the app. With X-Forwarded-For
 *       the client is the entry N positions from the RIGHT (each proxy appends
 *       the address it received the request from, so the right-most N-1
 *       entries were written by our proxies and everything further left was
 *       written by the client and is ignored). Example, Tailscale Funnel →
 *       Caddy → app: XFF = "<client>, <funnel>" → N = 2.
 *       If the header has fewer than N entries the request did not come
 *       through the expected chain, so the peer address is used.
 *
 *  CLIENT_IP_HEADER (default x-forwarded-for; only read when N > 0)
 *    x-forwarded-for | x-real-ip | cf-connecting-ip. The single-value headers
 *    are taken as-is (the proxy must overwrite them). On Cloudflare Workers
 *    use TRUSTED_PROXY_HOPS=1 + CLIENT_IP_HEADER=cf-connecting-ip: Cloudflare
 *    sets that header itself and drops any client-supplied copy.
 *
 * Values that are not syntactically an IP are ignored (never used as a key).
 */
export const CLIENT_IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'] as const;
export type ClientIpHeader = (typeof CLIENT_IP_HEADERS)[number];

export interface ClientIpConfig {
  hops: number;
  header: ClientIpHeader;
}

const MAX_HOPS = 10;
const reported = new Set<string>();

function reportOnce(key: string, fields: Record<string, unknown>) {
  if (reported.has(key) || reported.size > 64) return;
  reported.add(key);
  log.error('config.invalid_client_ip_settings', fields);
}

export function clientIpConfig(env: { TRUSTED_PROXY_HOPS?: string; CLIENT_IP_HEADER?: string } | undefined): ClientIpConfig {
  const rawHops = env?.TRUSTED_PROXY_HOPS?.trim() ?? '';
  let hops = 0;
  if (rawHops !== '') {
    if (/^\d{1,2}$/.test(rawHops) && Number(rawHops) <= MAX_HOPS) hops = Number(rawHops);
    else reportOnce(`hops:${rawHops}`, { setting: 'TRUSTED_PROXY_HOPS', value: rawHops.slice(0, 20), using: 0 });
  }
  const rawHeader = env?.CLIENT_IP_HEADER?.trim().toLowerCase() ?? '';
  let header: ClientIpHeader = 'x-forwarded-for';
  if (rawHeader !== '') {
    if ((CLIENT_IP_HEADERS as readonly string[]).includes(rawHeader)) header = rawHeader as ClientIpHeader;
    else reportOnce(`hdr:${rawHeader}`, { setting: 'CLIENT_IP_HEADER', value: rawHeader.slice(0, 40), using: header });
  }
  return { hops, header };
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Canonical IP text, or null if `raw` is not an IPv4/IPv6 address. */
export function normaliseIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.length === 0 || ip.length > 64) return null;
  // "[::1]:1234" / "1.2.3.4:5678" forms some proxies emit.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1]!;
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  ip = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (IPV4_RE.test(ip)) return ip;
  if (!/^[0-9a-f:.]+$/.test(ip) || !ip.includes(':')) return null;
  try {
    // WHATWG URL parsing validates and canonicalises IPv6 (compresses zeros).
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/**
 * Rate-limit key for an address: IPv4 as-is, IPv6 by /64 (one customer
 * subnet), so an attacker cannot rotate through the 2^64 addresses a single
 * ISP customer typically gets.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const full = expandIpv6(ip);
  return full ? `${full.slice(0, 4).join(':')}::/64` : ip;
}

/** Expand a canonical (WHATWG-serialised, hex-only) IPv6 address to 8 groups. */
function expandIpv6(ip: string): string[] | null {
  const [head, rest] = ip.split('::');
  const h = head ? head.split(':') : [];
  const r = rest ? rest.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array<string>(8 - h.length - r.length).fill('0'), ...r] : h;
  return groups.length === 8 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map((g) => g.padStart(4, '0')) : null;
}

/** TCP peer address as exposed by @hono/node-server (`incoming` binding). */
export function peerAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return normaliseIp(env?.incoming?.socket?.remoteAddress);
}

export function clientIp(c: Context): string | null {
  const { hops, header } = clientIpConfig(c.env as Record<string, string> | undefined);
  const peer = peerAddress(c);
  if (hops === 0) return peer;
  const value = c.req.header(header);
  if (!value) return peer;
  if (header !== 'x-forwarded-for') return normaliseIp(value) ?? peer;
  const entries = value.split(',').map((s) => s.trim());
  if (entries.length > 64 || entries.length < hops) return peer;
  return normaliseIp(entries[entries.length - hops]) ?? peer;
}
