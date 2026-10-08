import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { clientIp, clientIpConfig, ipKey, normaliseIp } from './client-ip';

const app = new Hono();
app.get('/ip', (c) => c.json({ ip: clientIp(c) }));

type Opts = { peer?: string; hops?: string; header?: string; headers?: Record<string, string> };
async function ipFor({ peer, hops, header, headers = {} }: Opts): Promise<string | null> {
  const env: Record<string, unknown> = {};
  if (peer !== undefined) env['incoming'] = { socket: { remoteAddress: peer } };
  if (hops !== undefined) env['TRUSTED_PROXY_HOPS'] = hops;
  if (header !== undefined) env['CLIENT_IP_HEADER'] = header;
  const res = await app.request('/ip', { headers }, env);
  return ((await res.json()) as { ip: string | null }).ip;
}

afterEach(() => vi.restoreAllMocks());

describe('normaliseIp', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'],
    [' 10.0.0.1 ', '10.0.0.1'],
    ['::ffff:192.168.1.7', '192.168.1.7'],
    ['::FFFF:192.168.1.7', '192.168.1.7'],
    ['2001:DB8:0:0:0:0:0:1', '2001:db8::1'],
    ['[2001:db8::1]:443', '2001:db8::1'],
    ['1.2.3.4:5678', '1.2.3.4'],
    ['::1', '::1'],
  ])('%j → %j', (input, out) => {
    expect(normaliseIp(input)).toBe(out);
  });

  it.each([
    'unknown',
    '',
    '256.1.1.1',
    '1.2.3',
    '01.2.3.4x',
    'evil.example.com',
    '1.2.3.4; DROP TABLE',
    '2001:db8::1::2',
    'g::1',
    '<script>',
    'a'.repeat(5000),
    '_hidden',
  ])('rejects %j', (input) => {
    expect(normaliseIp(input)).toBeNull();
  });
});

describe('ipKey', () => {
  it('IPv4 as-is, IPv6 grouped by /64', () => {
    expect(ipKey('203.0.113.9')).toBe('203.0.113.9');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe('2001:0db8:0001:0002::/64');
    expect(ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:0db8:0001:0002::/64');
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
    expect(ipKey('::1')).toBe('0000:0000:0000:0000::/64');
  });
});

describe('clientIpConfig', () => {
  it('defaults: 0 hops, x-forwarded-for', () => {
    expect(clientIpConfig(undefined)).toEqual({ hops: 0, header: 'x-forwarded-for' });
    expect(clientIpConfig({})).toEqual({ hops: 0, header: 'x-forwarded-for' });
  });

  it.each(['-1', '1.5', 'two', '11', '999999', '0x2', ' 2 3'])('invalid TRUSTED_PROXY_HOPS %j → 0 (trust nothing), logged', (v) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(clientIpConfig({ TRUSTED_PROXY_HOPS: v }).hops).toBe(0);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('unknown CLIENT_IP_HEADER falls back to x-forwarded-for', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(clientIpConfig({ TRUSTED_PROXY_HOPS: '1', CLIENT_IP_HEADER: 'true-client-ip' }).header).toBe('x-forwarded-for');
    expect(clientIpConfig({ CLIENT_IP_HEADER: 'X-Real-IP' }).header).toBe('x-real-ip');
  });
});

describe('clientIp — spoofing', () => {
  it('hops=0 (default): every forwarding header is ignored, the socket peer is used', async () => {
    const headers = {
      'X-Forwarded-For': '6.6.6.6',
      'X-Real-IP': '7.7.7.7',
      'CF-Connecting-IP': '8.8.8.8',
      Forwarded: 'for=9.9.9.9',
    };
    expect(await ipFor({ peer: '203.0.113.5', headers })).toBe('203.0.113.5');
    expect(await ipFor({ peer: '203.0.113.5', hops: '0', header: 'cf-connecting-ip', headers })).toBe('203.0.113.5');
  });

  it('hops=0 without a peer address (e.g. Workers misconfigured) → null, never a header value', async () => {
    expect(await ipFor({ headers: { 'X-Forwarded-For': '6.6.6.6' } })).toBeNull();
  });

  it('Funnel → Caddy → app (hops=2): client is 2nd from the right; left-most spoofed entries ignored', async () => {
    // Attacker sends XFF: 1.1.1.1, 2.2.2.2 ; Funnel appends the real client; Caddy appends Funnel.
    const xff = '1.1.1.1, 2.2.2.2, 198.51.100.20, 100.100.100.100';
    expect(await ipFor({ peer: '172.18.0.3', hops: '2', headers: { 'X-Forwarded-For': xff } })).toBe('198.51.100.20');
  });

  it('hops=2 with a 10 000-entry spoofed chain → peer (oversized header not trusted)', async () => {
    const xff = Array.from({ length: 10_000 }, (_, i) => `10.0.${i % 256}.${i % 200}`).join(',');
    expect(await ipFor({ peer: '172.18.0.3', hops: '2', headers: { 'X-Forwarded-For': xff } })).toBe('172.18.0.3');
  });

  it('hops=2 but the request bypassed one proxy (only 1 XFF entry) → peer', async () => {
    expect(await ipFor({ peer: '172.18.0.3', hops: '2', headers: { 'X-Forwarded-For': '6.6.6.6' } })).toBe('172.18.0.3');
  });

  it('hops=1: right-most entry (written by our proxy), not the client-supplied left part', async () => {
    expect(await ipFor({ peer: '127.0.0.1', hops: '1', headers: { 'X-Forwarded-For': '6.6.6.6, 198.51.100.7' } })).toBe('198.51.100.7');
  });

  it('garbage in the trusted position → peer', async () => {
    expect(await ipFor({ peer: '127.0.0.1', hops: '1', headers: { 'X-Forwarded-For': '1.1.1.1, evil' } })).toBe('127.0.0.1');
    expect(await ipFor({ peer: '127.0.0.1', hops: '1', headers: { 'X-Forwarded-For': '' } })).toBe('127.0.0.1');
  });

  it('cf-connecting-ip on Workers (hops=1, no peer)', async () => {
    expect(
      await ipFor({ hops: '1', header: 'cf-connecting-ip', headers: { 'CF-Connecting-IP': '2001:db8::5', 'X-Forwarded-For': '6.6.6.6' } }),
    ).toBe('2001:db8::5');
  });

  it('x-real-ip only when configured and hops>0; invalid value → peer', async () => {
    expect(await ipFor({ peer: '127.0.0.1', hops: '1', header: 'x-real-ip', headers: { 'X-Real-IP': '198.51.100.9' } })).toBe('198.51.100.9');
    expect(await ipFor({ peer: '127.0.0.1', hops: '1', header: 'x-real-ip', headers: { 'X-Real-IP': 'nope' } })).toBe('127.0.0.1');
    expect(await ipFor({ peer: '127.0.0.1', header: 'x-real-ip', headers: { 'X-Real-IP': '198.51.100.9' } })).toBe('127.0.0.1');
  });
});
