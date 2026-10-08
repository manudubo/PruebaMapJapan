import { Hono } from 'hono';
import type { Env, ContextVariables } from '../types';
import health from './health';
import usersRoute from './users';
import tripsRoute from './trips';
import publicRoute from './public';
import authRoute from './auth';
import recoveryRoute from './recovery';
import geocodeRoute from './geocode';

/**
 * Aggregates all API routes and mounts them under their respective prefixes.
 * Import this into the main app and mount it at `/api`.
 */
const routes = new Hono<{ Bindings: Env; Variables: ContextVariables }>();

routes.route('/health', health);
routes.route('/users', usersRoute);
routes.route('/trips', tripsRoute);

// Public routes — no authentication middleware applied here.
// Individual route handlers are responsible for not requiring auth.
routes.route('/public', publicRoute);

// Account recovery is unauthenticated. It is mounted BEFORE authRoute, whose
// authMiddleware (use '*') would otherwise answer 401 for these paths.
routes.route('/auth/recovery', recoveryRoute);
routes.route('/auth', authRoute);

// Nominatim proxy for the trip editor (SEC-18), authenticated.
routes.route('/geocode', geocodeRoute);

export default routes;
