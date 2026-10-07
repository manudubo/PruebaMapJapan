import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiResponse } from '../types';
import { dateConflict, pgErrorCode } from '../db/pg-errors';
import { EmailConflictError } from '../db/queries/users';
import { log } from '../observability/logger';
import { requestIdOf, routeLabel } from './request-context';

function where(c: Context) {
  return { request_id: requestIdOf(c), method: c.req.method, route: routeLabel(c) };
}

type Mapped = { status: 400 | 409; error: string; code: string };

/** 422 body for a BIZ-07 date-coherence violation (same shape as validation errors). */
export interface DateConflictResponse {
  success: false;
  error: string;
  code: 'date_conflict';
  issues: { path: string; message: string }[];
}

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
 * `catch {}` blocks; everything unexpected lands here, is logged as one
 * scrubbed JSON line with the request id and route pattern (never the query
 * string or bound SQL parameters), and gets a generic body — the
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
    log.warn('http.email_conflict', { ...where(c), status: 409 });
    const response: ApiResponse<never> = { success: false, error: err.message, code: 'email_conflict' };
    return c.json(response, 409);
  }

  const conflict = dateConflict(err);
  if (conflict) {
    // BIZ-07: a date-coherence trigger rejected the write. Its message was
    // written for the user (dates and the user's own destination name only),
    // so it is returned as-is, shaped like a validation error so editor forms
    // show it next to the field.
    log.warn('http.date_conflict', { ...where(c), status: 422, column: conflict.column });
    const body: DateConflictResponse = {
      success: false,
      error: conflict.message,
      code: 'date_conflict',
      issues: [{ path: conflict.column, message: conflict.message }],
    };
    return c.json(body, 422);
  }

  const sqlstate = pgErrorCode(err);
  const mapped = sqlstate ? CLIENT_ERRORS[sqlstate] : undefined;
  if (mapped) {
    log.warn('http.db_client_error', { ...where(c), status: mapped.status, sqlstate, error: err });
    const response: ApiResponse<never> = { success: false, error: mapped.error, code: mapped.code };
    return c.json(response, mapped.status);
  }

  // The error is scrubbed by the logger: Drizzle puts the bound parameters
  // (emails, OTP hashes) in its message and pg puts row values in `detail`.
  log.error('http.unhandled_error', { ...where(c), status: 500, error: err });
  const response: ApiResponse<never> = {
    success: false,
    error: 'Internal server error',
    code: 'internal_error',
  };
  return c.json(response, 500);
}
