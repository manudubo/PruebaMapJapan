import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { corsMiddleware } from './middleware/cors';
import { securityMiddleware } from './middleware/security';
import { errorHandler } from './middleware/errors';
import { requestContext } from './middleware/request-context';
import { POLICIES, rateLimit } from './middleware/rate-limit';
import routes from './routes';
import { healthResponse } from './routes/health';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
// Request id + access log outermost, so every response (including errors and
// preflights) carries X-Request-Id and is logged once.
app.use('*', requestContext);
// Security headers next so they also wrap CORS preflight responses.
app.use('*', securityMiddleware);
app.use('*', corsMiddleware);

// Per-IP ceiling on the whole API, before the body is read or a token is
// verified (cheap rejection of floods). After CORS so the SPA can read the
// 429 and its Retry-After. Endpoint-specific limits sit on the routes.
app.use('/api/*', rateLimit(POLICIES.apiPerIp));

// Refuse oversized bodies before any auth or DB work. Real payloads (an
// activity with long notes) are a few KB; without a cap one request could
// store megabytes in unbounded text columns.
const MAX_BODY_BYTES = 1024 * 1024;
app.use(
  '/api/*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ success: false, error: 'Payload too large' }, 413),
  }),
);

// ---------------------------------------------------------------------------
// Root health check (unauthenticated)
// ---------------------------------------------------------------------------
app.get('/', rateLimit(POLICIES.healthPerIp), healthResponse);

// ---------------------------------------------------------------------------
// API routes — all business logic lives under /api
// ---------------------------------------------------------------------------
app.route('/api', routes);

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => {
  return c.json({ success: false, error: 'Not found' }, 404);
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
app.onError(errorHandler);

// ---------------------------------------------------------------------------
// Cloudflare Workers entry point
// ---------------------------------------------------------------------------
export default app;
