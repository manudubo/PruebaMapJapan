/**
 * Startup wiring for the self-hosted Node server, kept out of server.ts (which
 * only binds the socket and handles signals) so every step is unit tested:
 *
 *  1. validate process.env (node/config.ts; includes the app's own OTP email
 *     resolver, so a mail misconfiguration stops the boot, SEC-08)
 *  2. LOG_LEVEL → the app's structured logger
 *  3. pg pool limits
 *  4. the fetch handler that hands the app its bindings plus the adapter's
 *     `incoming` (the rate limiter's TCP peer)
 */
import { configurePgPool } from '../db';
import { setMinLogLevel } from '../observability/logger';
import { loadServerConfig, type RawEnv, type ServerConfig } from './config';
import { createFetchHandler, type LogSink } from './runtime';

interface FetchApp {
  fetch: (request: Request, env: Record<string, unknown>) => Response | Promise<Response>;
}

export interface PreparedServer {
  config: ServerConfig;
  fetchHandler: (request: Request, nodeEnv?: Record<string, unknown>) => Promise<Response>;
}

/** Throws ServerConfigError (every problem at once) before touching any global state. */
export function prepareServer(
  app: FetchApp,
  raw: RawEnv,
  deps: { configurePgPool?: typeof configurePgPool; setMinLogLevel?: typeof setMinLogLevel; sink?: LogSink } = {},
): PreparedServer {
  const config = loadServerConfig(raw);
  (deps.setMinLogLevel ?? setMinLogLevel)(config.logLevel);
  (deps.configurePgPool ?? configurePgPool)(config.pool);
  const fetchHandler = createFetchHandler(app, config.bindings, deps.sink, config.logRequests);
  return { config, fetchHandler };
}
