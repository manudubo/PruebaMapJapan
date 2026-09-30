import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { corsMiddleware } from './middleware/cors';
import { securityMiddleware } from './middleware/security';
import routes from './routes';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use('*', corsMiddleware);
app.use('*', securityMiddleware);

// ---------------------------------------------------------------------------
// Root health check (unauthenticated)
// ---------------------------------------------------------------------------
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'PruebaMapJapan API is running',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

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
