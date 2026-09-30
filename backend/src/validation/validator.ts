import { zValidator as baseZValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { ZodSchema } from 'zod';

/** Body returned when a request fails schema validation. */
export interface ValidationErrorResponse {
  success: false;
  error: 'Validation failed';
  code: 'validation_error';
  issues: { path: string; message: string }[];
}

/**
 * Drop-in replacement for `@hono/zod-validator`'s `zValidator` that answers
 * validation failures with 422 Unprocessable Entity (the request is
 * well-formed JSON but semantically invalid — e.g. start after end, lat out
 * of range, or an empty PATCH) instead of the library's default 400, plus a
 * flat `issues` list a form can map onto its fields.
 */
export function zValidator<T extends ZodSchema, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return baseZValidator(target, schema, (result, c) => {
    if (!result.success) {
      const body: ValidationErrorResponse = {
        success: false,
        error: 'Validation failed',
        code: 'validation_error',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
      return c.json(body, 422);
    }
  });
}
