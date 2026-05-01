import type { Services } from '@pantrymind/core';
import { MenuPlanNotFoundError } from '@pantrymind/core';
import { suggestMenuSchema } from '@pantrymind/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

export function menusRouter(services: Services): Hono {
  const r = new Hono();

  r.post('/suggest', zValidator('json', suggestMenuSchema), async (c) => {
    const menu = await services.menu.suggest(c.req.valid('json'));
    return c.json(menu, 201);
  });

  r.get('/', async (c) => {
    const menus = await services.menu.list();
    return c.json({ menus });
  });

  r.get('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const menu = await services.menu.getById(id);
      return c.json(menu);
    } catch (err) {
      if (err instanceof MenuPlanNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  return r;
}
