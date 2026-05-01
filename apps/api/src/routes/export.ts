import type { Services } from '@pantrymind/core';
import { Hono } from 'hono';

export function exportRouter(services: Services): Hono {
  const r = new Hono();

  r.get('/json', async (c) => {
    const bundle = await services.export.exportAll();
    return c.json(bundle);
  });

  return r;
}
