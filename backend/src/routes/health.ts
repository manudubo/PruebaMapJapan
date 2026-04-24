import { Hono } from 'hono';
import type { Env } from '../types';

const health = new Hono<{ Bindings: Env }>();

/**
 * GET /api/health
 * Returns a simple liveness check with the current UTC timestamp.
 */
health.get('/', (c) => {
  return c.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'prueba-map-japan-api',
  });
});

export default health;
