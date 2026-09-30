import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiResponse } from '../types';
import { pgErrorCode } from '../db/pg-errors';
import { EmailConflictError } from '../db/queries/users';

type Mapped = { status: 400 | 409; error: string; code: string };

// Input the database itself rejected: the client sent something invalid that
// validation let through (bad numeric/date text, out-of-range value, CHECK).
const CLIENT_ERRORS: Record<string, Mapped> = {
  '22P02': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // invalid_text_representation
  '22003': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // numeric_value_out_of_range
  '22007': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // invalid_datetime_format
  '22008': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // datetime_field_overflow
  '22001': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // string_data_right_truncation
  '22021': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // character_not_in_repertoire (NUL in text)
  '22P05': { status: 400, error: 'Invalid input', code: 'invalid_input' }, // untranslatable_character (\u0000 in jsonb)
  '23514': { status: 400, error: 'Invalid input', code: 'constraint_violation' }, // check_violation
  '23505': { status: 409, error: 'Conflict', code: 'conflict' }, // unique_violation
  '23503': { status: 409, error: 'Conflict', code: 'conflict' }, // foreign_key_violation
};

/**
 * Global error handler (M-09). Routes no longer swallow errors in
 * `catch {}` blocks; everything unexpected lands here, is logged with the
 * request line (visible in `wrangler tail`), and gets a generic body — the
 * raw error message is never sent to the client.
 */
export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException && err.status < 500) {
    // Deliberate client errors (e.g. malformed JSON body → 400) keep their
    // status; a 5xx HTTPException is still a server fault, handled below.
    const response: ApiResponse<never> = { success: false, error: err.message || 'Bad request' };
    return c.json(response, err.status);
  }

  if (err instanceof EmailConflictError) {
    // DATA-02: a different account already owns this email.
    console.warn(`${c.req.method} ${c.req.path} → 409:`, err.message);
    const response: ApiResponse<never> = { success: false, error: err.message, code: 'email_conflict' };
    return c.json(response, 409);
  }

  const sqlstate = pgErrorCode(err);
  const mapped = sqlstate ? CLIENT_ERRORS[sqlstate] : undefined;
  if (mapped) {
    console.warn(`${c.req.method} ${c.req.path} → ${mapped.status} (SQLSTATE ${sqlstate}):`, err);
    const response: ApiResponse<never> = { success: false, error: mapped.error, code: mapped.code };
    return c.json(response, mapped.status);
  }

  console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  const response: ApiResponse<never> = {
    success: false,
    error: 'Internal server error',
    code: 'internal_error',
  };
  return c.json(response, 500);
}
