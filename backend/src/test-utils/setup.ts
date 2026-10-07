/**
 * vitest setupFiles (every test file):
 *  - keep the per-request access log (info) out of test output. Warnings and
 *    errors are still written, so tests that spy on console.warn/error work;
 *  - switch abuse rate limiting off. Many suites fire bursts of requests from
 *    one "client" on purpose (race tests); the limiter has its own suites
 *    (rate-limit*.test.ts, tests/adversarial/rate-limit.test.ts) that turn it
 *    back on with __setRateLimitingEnabledForTests(true).
 */
import { setMinLogLevel } from '../observability/logger';
import { __setRateLimitingEnabledForTests } from '../middleware/rate-limit';

setMinLogLevel(process.env.TEST_LOG_LEVEL ?? 'warn');
__setRateLimitingEnabledForTests(false);
