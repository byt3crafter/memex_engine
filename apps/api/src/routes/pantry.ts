import type { Services } from '@pantrymind/core';
import { PantryItemNotFoundError } from '@pantrymind/core';
import {
  bulkPantryUpdateSchema,
  createPantryItemSchema,
  pantryCategorySchema,
  updatePantryItemSchema,
} from '@pantrymind/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

const listQuerySchema = z.object({
  category: pantryCategorySchema.optional(),
  isAvailable: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  search: z.string().min(1).optional(),
});

export function pantryRouter(services: Services): Hono {
  const r = new Hono();

  r.get('/', zValidator('query', listQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const filter: {
      category?: ReturnType<typeof pantryCategorySchema.parse>;
      isAvailable?: boolean;
      search?: string;
    } = {};
    if (q.category !== undefined) filter.category = q.category;
    if (q.isAvailable !== undefined) filter.isAvailable = q.isAvailable;
    if (q.search !== undefined) filter.search = q.search;
    const items = await services.pantry.list(filter);
    return c.json({ items });
  });

  r.post('/items', zValidator('json', createPantryItemSchema), async (c) => {
    const item = await services.pantry.create(c.req.valid('json'));
    return c.json(item, 201);
  });

  r.patch('/items/:id', zValidator('json', updatePantryItemSchema), async (c) => {
    const id = c.req.param('id');
    try {
      const item = await services.pantry.update(id, c.req.valid('json'));
      return c.json(item);
    } catch (err) {
      if (err instanceof PantryItemNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  r.delete('/items/:id', async (c) => {
    const id = c.req.param('id');
    try {
      await services.pantry.delete(id);
    } catch (err) {
      if (err instanceof PantryItemNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
    return c.body(null, 204);
  });

  r.post('/bulk-update', zValidator('json', bulkPantryUpdateSchema), async (c) => {
    const result = await services.pantry.bulkUpdate(c.req.valid('json'));
    return c.json(result);
  });

  return r;
}
