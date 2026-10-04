import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Opt-in checks against real third-party services (`npm run check:tiles`).
// Kept out of the default suite and CI: they need internet and hit external servers.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
