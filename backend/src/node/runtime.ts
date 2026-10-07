/**
 * Node runtime pieces for the self-hosted server: JSON logging, the fetch
 * handler that feeds the (unchanged) Hono app its bindings, and graceful
 * shutdown. Kept apart from server.ts so they can be unit tested.
 */
import { format } from 'node:util';
import type { Server } from 'node:http';

type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string, level: Level) => void;

const defaultSink: LogSink = (line, level) => {
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
};

/** One JSON object per line: {"time","level","msg",...fields}. */
export function logLine(level: Level, msg: string, fields: Record<string, unknown> = {}, sink = defaultSink): void {
  sink(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }), level);
}

function isJsonObjectLine(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Route console.* through logLine so everything the app prints (it logs with
 * plain console.error) becomes one JSON line. A message that is already a
 * single JSON object is passed through untouched, not double-wrapped.
 */
export function installJsonConsole(sink = defaultSink): () => void {
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const make = (level: Level) => (...args: unknown[]) => {
    if (args.length === 1 && isJsonObjectLine(args[0])) {
      sink(args[0], level);
      return;
    }
    logLine(level, format(...args), {}, sink);
  };
  console.log = make('info');
  console.info = make('info');
  console.warn = make('warn');
  console.error = make('error');
  console.debug = make('debug');
  return () => Object.assign(console, original);
}

interface FetchApp {
  fetch: (request: Request, env: Record<string, unknown>) => Response | Promise<Response>;
}

/**
 * Build the @hono/node-server fetch callback. `nodeEnv` is the adapter's
 * `{ incoming, outgoing }`; it is merged into the bindings because the app
 * reads `c.env.incoming.socket.remoteAddress` as the TCP peer (rate limiting
 * keys on it — without it every client would share one bucket).
 */
export function createFetchHandler(
  app: FetchApp,
  bindings: Record<string, unknown>,
  sink = defaultSink,
): (request: Request, nodeEnv?: Record<string, unknown>) => Promise<Response> {
  return async (request, nodeEnv) => {
    const started = performance.now();
    const env = { ...bindings, ...(nodeEnv ?? {}) };
    let status = 500;
    try {
      const response = await app.fetch(request, env);
      status = response.status;
      return response;
    } finally {
      // Path only: query strings can carry codes or tokens.
      const { pathname } = new URL(request.url);
      if (pathname !== '/api/health' && pathname !== '/api/health/ready') {
        logLine(
          status >= 500 ? 'error' : 'info',
          'request',
          { method: request.method, path: pathname, status, ms: Math.round(performance.now() - started) },
          sink,
        );
      }
    }
  };
}

/**
 * Stop accepting connections, let in-flight requests finish for up to
 * `timeoutMs`, then force-close what is left and run `cleanup` (pg pools).
 * Resolves with true when everything drained in time.
 */
export async function gracefulShutdown(
  server: Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>,
  timeoutMs: number,
  cleanup: () => Promise<void>,
): Promise<boolean> {
  const closed = new Promise<boolean>((resolve) => server.close(() => resolve(true)));
  // Keep-alive sockets become idle as their last response finishes; close
  // them as they do instead of waiting for the keep-alive timeout.
  server.closeIdleConnections();
  const sweeper = setInterval(() => server.closeIdleConnections(), 50);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const drained = await Promise.race([closed, timedOut]);
  clearTimeout(timer);
  clearInterval(sweeper);
  if (!drained) server.closeAllConnections();
  await cleanup();
  return drained;
}
