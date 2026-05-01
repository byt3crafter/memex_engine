import { bearerAuth } from 'hono/bearer-auth';
import type { MiddlewareHandler } from 'hono';

/**
 * Bearer-token gate for /api/v1/*. Tokens are read from
 * HEALTHLOOP_API_TOKEN; we never log them. Hono's bearerAuth handles
 * the constant-time comparison and `WWW-Authenticate` response.
 */
export function authMiddleware(token: string): MiddlewareHandler {
  return bearerAuth({ token });
}
