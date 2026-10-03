/**
 * Helpers to inspect Postgres errors regardless of driver (node-postgres or
 * Neon) or wrapping: Drizzle ≥0.44 wraps driver errors in DrizzleQueryError
 * with the original error as `cause`.
 */

function findField(err: unknown, field: 'code' | 'constraint'): unknown {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === 'object'; depth++) {
    const value = (cur as Record<string, unknown>)[field];
    if (typeof value === 'string' && (field !== 'code' || /^[0-9A-Z]{5}$/.test(value))) return value;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** SQLSTATE of a Postgres error (e.g. "23505"), or undefined. */
export function pgErrorCode(err: unknown): string | undefined {
  return findField(err, 'code') as string | undefined;
}

/** Name of the constraint/index a Postgres error reports, or undefined. */
export function pgConstraint(err: unknown): string | undefined {
  return findField(err, 'constraint') as string | undefined;
}

/** True for a unique violation on the named constraint/index. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return pgErrorCode(err) === '23505' && pgConstraint(err) === constraint;
}
