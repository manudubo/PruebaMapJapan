/**
 * Production Node entry point for self-hosting (deploy/selfhost,
 * docs/SELF-HOSTING.md). Runs the SAME Hono app as the Cloudflare Worker
 * (src/index.ts); only the bindings come from process.env instead of wrangler.
 *
 * - validates the environment and exits(1) listing every problem
 * - DB_DRIVER=pg (TCP pool, size/timeouts from PG_POOL_MAX etc.)
 * - JSON log lines on stdout/stderr
 * - SIGTERM/SIGINT: stop accepting, drain in-flight requests, close pg pools
 *
 * Not loaded by wrangler (main = src/index.ts), so the Worker build is unchanged.
 * Bundled to dist/server.mjs by `npm run build:node`.
 */
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import app from './index';
import { closeDbPools, configurePgPool } from './db';
import { describeConfig, loadServerConfig, ServerConfigError, type ServerConfig } from './node/config';
import { createFetchHandler, gracefulShutdown, installJsonConsole, logLine } from './node/runtime';

installJsonConsole();

function loadConfigOrExit(): ServerConfig {
  try {
    return loadServerConfig(process.env);
  } catch (err) {
    if (err instanceof ServerConfigError) {
      logLine('error', 'invalid configuration, refusing to start', { problems: err.problems });
    } else {
      logLine('error', 'configuration check failed', { error: String(err) });
    }
    process.exit(1);
  }
}
const config = loadConfigOrExit();

configurePgPool(config.pool);
const fetchHandler = createFetchHandler(app, config.bindings);

const server = serve(
  {
    fetch: (request, nodeEnv) => fetchHandler(request, nodeEnv as Record<string, unknown>),
    port: config.port,
    hostname: config.host,
  },
  () => logLine('info', 'server listening', describeConfig(config)),
) as Server;

// Slow or idle clients must not hold sockets forever (Node defaults are generous).
server.requestTimeout = 30_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 5_000;

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logLine('info', 'shutting down', { signal, timeoutMs: config.shutdownTimeoutMs });
  gracefulShutdown(server, config.shutdownTimeoutMs, closeDbPools).then(
    (drained) => {
      logLine('info', 'shutdown complete', { drained });
      process.exit(0);
    },
    (err: unknown) => {
      logLine('error', 'shutdown failed', { error: String(err) });
      process.exit(1);
    },
  );
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logLine('error', 'unhandled promise rejection', { error: String(reason) });
});
