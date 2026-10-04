import type { Plugin } from 'vite';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';

// SEC-16: derive the service-worker cache name from the build output so every
// deploy gets a fresh cache (public/sw.js is copied verbatim by Vite).
export function swVersionPlugin(): Plugin {
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
      // Precache list: every emitted chunk under assets/ (paths relative to the SW scope).
      const assets: string[] = [];
      const collect = (dir: string, rel: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.isDirectory()) collect(resolve(dir, entry.name), `${rel}${entry.name}/`);
          else assets.push(`./${rel}${entry.name}`);
        }
      };
      const assetsDir = resolve(outDir, 'assets');
      if (existsSync(assetsDir)) collect(assetsDir, 'assets/');
      const swPath = resolve(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      writeFileSync(
        swPath,
        sw
          .replace('[] /* __BUILD_ASSETS__ */', JSON.stringify(assets))
          .replace(/__BUILD_VERSION__/g, hash.digest('hex').slice(0, 12)),
      );
    },
  };
}
