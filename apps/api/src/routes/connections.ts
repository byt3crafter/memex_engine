import { ConnectionNotFoundError, type Kernel } from '@memex/kernel';
import { pairCompleteInputSchema, pairStartInputSchema } from '@memex/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

export function connectionsRouter(kernel: Kernel): Hono {
  const r = new Hono();

  // Authed: start a new pairing. The current user (resolved by auth
  // middleware) is the user whose context the new connection will live
  // under.
  r.post('/pair-start', zValidator('json', pairStartInputSchema), async (c) => {
    const user = c.get('user');
    const input = c.req.valid('json');
    const result = await kernel.services.pairing.start(user.id, input);
    return c.json(result, 201);
  });

  // Authed: list connections for the current user.
  r.get('/', async (c) => {
    const user = c.get('user');
    const connections = await kernel.services.connections.listForUser(user.id);
    return c.json({ connections });
  });

  // Authed: revoke a connection. A user can only revoke their own.
  r.delete('/:id', async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    try {
      const revoked = await kernel.services.connections.revoke(id, user.id);
      return c.json(revoked);
    } catch (err) {
      if (err instanceof ConnectionNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  return r;
}

/**
 * Public pair-complete router — no auth, takes the pairing code and
 * returns the long-lived token. Mounted at /api/v1/connections/pair-complete
 * outside the bearer-auth gate.
 */
export function pairCompleteRouter(kernel: Kernel): Hono {
  const r = new Hono();

  r.post('/pair-complete', zValidator('json', pairCompleteInputSchema), async (c) => {
    const input = c.req.valid('json');
    const result = await kernel.services.pairing.complete(input);
    return c.json(result);
  });

  return r;
}
