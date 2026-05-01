import type { Services } from '@pantrymind/core';
import { updateUserProfileSchema } from '@pantrymind/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

export function profileRouter(services: Services): Hono {
  const r = new Hono();

  r.get('/', async (c) => {
    const profile = await services.profile.getCurrentProfile();
    return c.json(profile);
  });

  r.put('/', zValidator('json', updateUserProfileSchema), async (c) => {
    const input = c.req.valid('json');
    const profile = await services.profile.updateCurrentProfile(input);
    return c.json(profile);
  });

  return r;
}
