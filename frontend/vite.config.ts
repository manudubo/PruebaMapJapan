import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, writeFileSync } from 'fs';

function cspPlugin(): Plugin {
  const keycloakUrl = process.env['VITE_KEYCLOAK_URL'] ?? 'http://localhost:8080';
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://cdn-icons-png.flaticon.com",
    `connect-src 'self' https://api.allorigins.win https://corsproxy.io https://api.open-meteo.com https://nominatim.openstreetmap.org https://fonts.googleapis.com ${keycloakUrl}`,
    "font-src 'self' https://fonts.gstatic.com",
    `frame-src 'self' ${keycloakUrl}`,
    "manifest-src 'self'",
    "worker-src 'self'",
  ].join('; ');

  return {
    name: 'csp-meta',
    transformIndexHtml(html: string): string {
      return html.replace(
        '<head>',
        `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}

// SEC-16: derive the service-worker cache name from the build output so every
// deploy gets a fresh cache (public/sw.js is copied verbatim by Vite).
function swVersionPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const hash = createHash('sha256');
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const p = resolve(dir, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (entry.name !== 'sw.js') hash.update(entry.name).update(readFileSync(p));
        }
      };
      walk(outDir);
      const swPath = resolve(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      writeFileSync(swPath, sw.replace(/__BUILD_VERSION__/g, hash.digest('hex').slice(0, 12)));
    },
  };
}

export default defineConfig({
  // Base URL para GitHub Pages
  base: '/PruebaMapJapan/',
  plugins: [cspPlugin(), swVersionPlugin()],

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        // Existing static city pages — kept for full backwards compatibility
        main: resolve(__dirname, 'index.html'),
        tokyo: resolve(__dirname, 'tokyo.html'),
        nagoya: resolve(__dirname, 'nagoya.html'),
        takayama: resolve(__dirname, 'takayama.html'),
        kyoto: resolve(__dirname, 'kyoto.html'),
        osaka: resolve(__dirname, 'osaka.html'),
        naoshima: resolve(__dirname, 'naoshima.html'),
        hakone: resolve(__dirname, 'hakone.html'),
        tokyo2: resolve(__dirname, 'tokyo2.html'),
        // New dynamic pages
        dashboard: resolve(__dirname, 'dashboard.html'),
        trip: resolve(__dirname, 'trip.html'),
        profile: resolve(__dirname, 'profile.html'),
        'trip-edit': resolve(__dirname, 'trip-edit.html'),
      },
      output: {
        manualChunks: {
          leaflet: ['leaflet'],
        },
      },
    },
  },
  
  server: {
    port: 5173,
  },

  preview: {
    port: 5173,
  },
});
