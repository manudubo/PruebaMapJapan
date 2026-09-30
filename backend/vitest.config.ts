import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ARCH-06: creates an ephemeral, migrated Postgres database per run
    // (TEST_DATABASE_URL, default postgresql://postgres:postgres@localhost:5432/postgres).
    globalSetup: ['./src/test-utils/global-setup.ts'],
    // DB-backed test files share that database and TRUNCATE it between
    // tests, so files must not run concurrently.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
