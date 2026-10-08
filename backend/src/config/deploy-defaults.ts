/**
 * Deployment defaults shared with Terraform (terraform/keycloak reads the
 * same JSON file), so the GitHub Pages origin is written down exactly once.
 * A typo here once shipped as the wrong account name and would have made both
 * CORS and the Keycloak redirect URIs reject the real site.
 */
import defaults from '../../../config/deploy-defaults.json';

/** The deployed frontend origin (scheme://host, no path, no trailing slash). */
export const PAGES_ORIGIN: string = defaults.pagesOrigin;

/** Path the app is served under on Pages (vite.config.ts `base`). */
export const APP_BASE_PATH: string = defaults.appBasePath;
