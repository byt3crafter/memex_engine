/**
 * /admin/* — operator endpoints, guarded by the bootstrap token.
 *
 * Phase 1 ships exactly one: POST /admin/bootstrap. On a fresh install
 * (no users exist), the operator hits this with the bootstrap token to
 * provision the founder user and receive a first pairing-start
 * payload. After that, the bootstrap token is still usable for further
 * /admin work but the bootstrap endpoint itself becomes a no-op /
 * idempotent re-fetch.
 */
import { connectionKindSchema, scopeSchema } from '@memex/schemas';
import type { Kernel } from '@memex/kernel';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

const bootstrapInputSchema = z.object({
  email: z.string().email().optional(),
  displayName: z.string().min(1).max(120).default('Founder'),
  timezone: z.string().min(1).default('UTC'),
  enabledModules: z.array(z.string()).optional(),
  firstClient: z
    .object({
      name: z.string().min(1).max(120).default('Bootstrap pairing'),
      kind: connectionKindSchema.default('mcp_stdio'),
      scopes: z.array(scopeSchema).default([]),
    })
    .default({
      name: 'Bootstrap pairing',
      kind: 'mcp_stdio',
      scopes: [],
    }),
});

export function adminRouter(kernel: Kernel): Hono {
  const r = new Hono();

  r.post('/bootstrap', zValidator('json', bootstrapInputSchema), async (c) => {
    const input = c.req.valid('json');

    let founder = (await kernel.services.users.list()).find((u) => u.role === 'founder');
    let alreadyExisted = false;

    if (founder) {
      alreadyExisted = true;
    } else {
      founder = await kernel.services.users.create({
        ...(input.email !== undefined ? { email: input.email } : {}),
        displayName: input.displayName,
        timezone: input.timezone,
        role: 'founder',
        ...(input.enabledModules !== undefined ? { enabledModules: input.enabledModules } : {}),
      });
    }

    const pair = await kernel.services.pairing.start(founder.id, {
      clientName: input.firstClient.name,
      clientKind: input.firstClient.kind,
      scopes: input.firstClient.scopes,
      expiresInSeconds: 600,
    });

    return c.json(
      {
        founder,
        alreadyExisted,
        pairing: pair,
      },
      alreadyExisted ? 200 : 201,
    );
  });

  return r;
}
