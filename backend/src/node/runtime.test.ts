import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createFetchHandler, gracefulShutdown, installJsonConsole, logLine } from './runtime';

function collect() {
  const lines: { line: string; level: string }[] = [];
  return { lines, sink: (line: string, level: string) => lines.push({ line, level }) };
}

describe('logLine / installJsonConsole', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it('writes one JSON object per line', () => {
    const { lines, sink } = collect();
    logLine('info', 'hello', { a: 1 }, sink);
    const parsed = JSON.parse(lines[0]!.line);
    expect(parsed).toMatchObject({ level: 'info', msg: 'hello', a: 1 });
    expect(typeof parsed.time).toBe('string');
  });

  it('wraps plain console output and passes JSON lines through', () => {
    const { lines, sink } = collect();
    restore = installJsonConsole(sink);
    console.error('db:', new Error('boom').message, 42);
    console.log(JSON.stringify({ level: 'warn', msg: 'already structured' }));
    restore();
    restore = null;
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: 'error', msg: 'db: boom 42' });
    expect(lines[0]!.level).toBe('error');
    expect(lines[1]!.line).toBe('{"level":"warn","msg":"already structured"}');
  });
});

describe('createFetchHandler', () => {
  it('merges the node adapter env (incoming) into the bindings', async () => {
    const seen: Record<string, unknown>[] = [];
    const app = { fetch: (_req: Request, env: Record<string, unknown>) => (seen.push(env), new Response('ok')) };
    const { sink } = collect();
    const handler = createFetchHandler(app, { DATABASE_URL: 'x', ENVIRONMENT: 'production' }, sink);
    const incoming = { socket: { remoteAddress: '203.0.113.9' } };
    await handler(new Request('http://h/api/x'), { incoming, outgoing: {} });
    expect(seen[0]).toMatchObject({ DATABASE_URL: 'x', ENVIRONMENT: 'production', incoming });
  });

  it('logs method, path (no query), status and duration; skips health probes', async () => {
    const app = { fetch: (req: Request) => new Response(null, { status: req.url.includes('boom') ? 503 : 204 }) };
    const { lines, sink } = collect();
    const handler = createFetchHandler(app, {}, sink);
    await handler(new Request('http://h/api/trips?token=secret'));
    await handler(new Request('http://h/api/health'));
    await handler(new Request('http://h/api/health/ready'));
    await handler(new Request('http://h/boom'));
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!.line);
    expect(first).toMatchObject({ msg: 'request', method: 'GET', path: '/api/trips', status: 204 });
    expect(lines[0]!.line).not.toContain('secret');
    expect(JSON.parse(lines[1]!.line)).toMatchObject({ level: 'error', status: 503 });
  });

  it('logs a 500 when the app throws', async () => {
    const app = { fetch: () => Promise.reject(new Error('kaput')) };
    const { lines, sink } = collect();
    await expect(createFetchHandler(app, {}, sink)(new Request('http://h/x'))).rejects.toThrow('kaput');
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ status: 500, level: 'error' });
  });

  it('exposes the real TCP peer to the app through @hono/node-server', async () => {
    // What the rate limiter relies on: c.env.incoming.socket.remoteAddress.
    const app = new Hono<{ Bindings: { incoming?: { socket: { remoteAddress?: string } }; FOO: string } }>();
    app.get('/peer', (c) => c.json({ peer: c.env.incoming?.socket.remoteAddress ?? 'unknown', foo: c.env.FOO }));
    const { sink } = collect();
    const handler = createFetchHandler(app as never, { FOO: 'bar' }, sink);
    const server = serve({
      fetch: (req, env) => handler(req, env as Record<string, unknown>),
      port: 0,
      hostname: '127.0.0.1',
    }) as Server;
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address() as AddressInfo;
    const body = await (await fetch(`http://127.0.0.1:${port}/peer`)).json();
    await new Promise((r) => server.close(r));
    expect(body).toEqual({ peer: '127.0.0.1', foo: 'bar' });
  });
});

describe('gracefulShutdown', () => {
  it('lets an in-flight request finish, then runs cleanup', async () => {
    let release!: () => void;
    const server = createServer((_req, res) => {
      new Promise<void>((r) => (release = r)).then(() => res.end('done'));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const response = new Promise<string>((resolve, reject) => {
      httpRequest({ port, host: '127.0.0.1', path: '/' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      })
        .on('error', reject)
        .end();
    });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const cleanup = vi.fn(async () => {});
    const shutdown = gracefulShutdown(server, 5_000, cleanup);
    expect(cleanup).not.toHaveBeenCalled();
    release();
    await expect(response).resolves.toBe('done');
    await expect(shutdown).resolves.toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('force-closes stuck connections after the timeout', async () => {
    const server = createServer(() => {
      /* never answers */
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const failed = new Promise<string>((resolve) => {
      httpRequest({ port, host: '127.0.0.1', path: '/' }, () => resolve('answered'))
        .on('error', (err) => resolve(err.message))
        .end();
    });
    await new Promise((r) => setTimeout(r, 50));
    const cleanup = vi.fn(async () => {});
    await expect(gracefulShutdown(server, 100, cleanup)).resolves.toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(failed).resolves.toMatch(/socket hang up|ECONNRESET/);
  });
});
