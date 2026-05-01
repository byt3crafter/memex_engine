import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

export function errorHandler(logger: Logger): ErrorHandler {
  return (err: Error, c: Context) => {
    if (err instanceof HTTPException) {
      const body: ApiErrorBody = {
        error: err.message || 'http_error',
        code: `http_${err.status}`,
      };
      return c.json(body, err.status);
    }
    if (err instanceof ZodError) {
      const body: ApiErrorBody = {
        error: 'validation failed',
        code: 'validation_error',
        details: err.flatten(),
      };
      return c.json(body, 400);
    }
    logger.error({ err }, 'unhandled error');
    const body: ApiErrorBody = {
      error: 'internal server error',
      code: 'internal_error',
    };
    return c.json(body, 500);
  };
}
