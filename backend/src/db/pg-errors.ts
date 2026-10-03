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

/**
 * SQLSTATE raised by the BIZ-07 date-coherence triggers (migration 0008).
 * Their MESSAGE is written for end users and COLUMN names the offending field.
 */
export const DATE_CONFLICT_SQLSTATE = 'DC001';

/**
 * Message and column of a BIZ-07 date-conflict error, or undefined for any
 * other error. Read from the same (innermost driver) error object that
 * carries the SQLSTATE — the Drizzle wrapper's message is the failed SQL.
 */
export function dateConflict(err: unknown): { message: string; column: string } | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === 'object'; depth++) {
    const e = cur as Record<string, unknown>;
    if (e['code'] === DATE_CONFLICT_SQLSTATE && typeof e['message'] === 'string') {
      return { message: e['message'], column: typeof e['column'] === 'string' ? e['column'] : '' };
    }
    cur = e['cause'];
  }
  return undefined;
}

/** True for a unique violation on the named constraint/index. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return pgErrorCode(err) === '23505' && pgConstraint(err) === constraint;
}
