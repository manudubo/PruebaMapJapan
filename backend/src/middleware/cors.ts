import { cors } from 'hono/cors';

/**
 * CORS middleware configured for the PruebaMapJapan frontend.
 *
 * In production, replace the wildcard origin with your actual frontend domain,
 * e.g. "https://manud.github.io" or your custom domain.
 */
export const corsMiddleware = cors({
  origin: (origin) => {
    // Allow GitHub Pages deployment and local dev
    const allowed = [
      'https://manud.github.io',
      'http://localhost:3000',
      'http://localhost:5173',
    ];
    if (!origin || allowed.includes(origin)) {
      return origin ?? '*';
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true,
});
