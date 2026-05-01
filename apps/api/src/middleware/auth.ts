/**
 * Bearer-token auth. Resolves the token by hash against the connection
 * table, attaches { user, connection } to the Hono context, and updates
 * lastUsedAt asynchronously.
 *
 * The bootstrap token (config.bootstrapToken) takes a separate path
 * via bootstrapMiddleware: it does not look up a connection — instead
 * it grants admin scope, but only to /admin/* endpoints.
 */
import type { Kernel } from '@memex/kernel';
import type { Connection, User } from '@memex/schemas';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

declare module 'hono' {
  interface ContextVariableMap {
    user: User;
    connection: Connection;
  }
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}

export function authMiddleware(kernel: Kernel): MiddlewareHandler {
  return async (c, next) => {
    const token = extractBearer(c.req.header('Authorization'));
    if (!token) {
      throw new HTTPException(401, { message: 'missing bearer token' });
    }
    const lookup = await kernel.services.connections.lookupByToken(token);
    if (!lookup) {
      throw new HTTPException(401, { message: 'invalid or revoked token' });
    }
    const user = await kernel.services.users.getById(lookup.userId);
    if (!user.isActive) {
      throw new HTTPException(403, { message: 'user is deactivated' });
    }
    c.set('user', user);
    c.set('connection', lookup.connection);
    // Fire-and-forget — don't block the request on a write.
    void kernel.services.connections.touchLastUsed(lookup.connection.id).catch(() => {});
    await next();
  };
}

/**
 * Guards /admin/* routes. Accepts the kernel bootstrap token only.
 * Used so the operator can set up the founder user before any
 * connection exists.
 */
export function bootstrapMiddleware(kernel: Kernel): MiddlewareHandler {
  return async (c, next) => {
    const token = extractBearer(c.req.header('Authorization'));
    if (!token || token !== kernel.config.bootstrapToken) {
      throw new HTTPException(401, { message: 'invalid bootstrap token' });
    }
    await next();
  };
}
