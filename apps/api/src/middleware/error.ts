import {
  ConnectionNotFoundError,
  InvalidPairingCodeError,
  PairingCodeExpiredError,
  UserNotFoundError,
} from '@memex/kernel';
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
      return c.json<ApiErrorBody>(
        { error: 'validation failed', code: 'validation_error', details: err.flatten() },
        400,
      );
    }
    if (err instanceof InvalidPairingCodeError || err instanceof PairingCodeExpiredError) {
      return c.json<ApiErrorBody>({ error: err.message, code: err.code }, 400);
    }
    if (err instanceof UserNotFoundError || err instanceof ConnectionNotFoundError) {
      return c.json<ApiErrorBody>({ error: err.message, code: err.code }, 404);
    }
    logger.error({ err }, 'unhandled error');
    return c.json<ApiErrorBody>({ error: 'internal server error', code: 'internal_error' }, 500);
  };
}
