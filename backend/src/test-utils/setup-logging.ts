/**
 * vitest setupFiles: keep the per-request access log (info) out of test
 * output. Warnings and errors are still written, so tests that spy on
 * console.warn/console.error keep working.
 */
import { setMinLogLevel } from '../observability/logger';

setMinLogLevel(process.env.TEST_LOG_LEVEL ?? 'warn');
