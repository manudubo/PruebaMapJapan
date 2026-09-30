import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { corsMiddleware } from './middleware/cors';
import { securityMiddleware } from './middleware/security';
import routes from './routes';
import { healthResponse } from './routes/health';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
// Security headers first so they also wrap CORS preflight responses.
app.use('*', securityMiddleware);
app.use('*', corsMiddleware);

// ---------------------------------------------------------------------------
// Root health check (unauthenticated)
// ---------------------------------------------------------------------------
app.get('/', healthResponse);

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
app.onError((err, c) => {
  // Deliberate HTTP errors (e.g. Hono's validator rejecting malformed JSON
  // with 400) keep their status instead of being reported as a server fault.
  if (err instanceof HTTPException && err.status < 500) {
    return c.json({ success: false, error: err.message }, err.status);
  }
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error', code: 'internal_error' }, 500);
});

// ---------------------------------------------------------------------------
// Cloudflare Workers entry point
// ---------------------------------------------------------------------------
export default app;
