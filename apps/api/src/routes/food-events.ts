import type { Services } from '@pantrymind/core';
import { FoodEventNotFoundError } from '@pantrymind/core';
import {
  createFoodEventItemSchema,
  createFoodEventSchema,
  createMealOutcomeSchema,
  foodEventTypeSchema,
  isoDateTimeSchema,
  updateFoodEventSchema,
} from '@pantrymind/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

const listQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  type: foodEventTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const addItemsSchema = z.object({
  items: z.array(createFoodEventItemSchema).min(1).max(50),
});

function notFoundHandler<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((err) => {
    if (err instanceof FoodEventNotFoundError) {
      throw new HTTPException(404, { message: err.message });
    }
    throw err;
  });
}

export function foodEventsRouter(services: Services): Hono {
  const r = new Hono();

  r.post('/', zValidator('json', createFoodEventSchema), async (c) => {
    const ev = await services.foodEvent.create(c.req.valid('json'));
    return c.json(ev, 201);
  });

  r.get('/', zValidator('query', listQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const opts: {
      from?: string;
      to?: string;
      eventType?: ReturnType<typeof foodEventTypeSchema.parse>;
      limit?: number;
    } = {};
    if (q.from !== undefined) opts.from = q.from;
    if (q.to !== undefined) opts.to = q.to;
    if (q.type !== undefined) opts.eventType = q.type;
    if (q.limit !== undefined) opts.limit = q.limit;
    const events = await services.foodEvent.list(opts);
    return c.json({ events });
  });

  r.get('/:id', async (c) => {
    const id = c.req.param('id');
    const ev = await notFoundHandler(services.foodEvent.getById(id));
    return c.json(ev);
  });

  r.patch('/:id', zValidator('json', updateFoodEventSchema), async (c) => {
    const id = c.req.param('id');
    const ev = await notFoundHandler(services.foodEvent.update(id, c.req.valid('json')));
    return c.json(ev);
  });

  r.post('/:id/items', zValidator('json', addItemsSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const ev = await notFoundHandler(services.foodEvent.addItems(id, body.items));
    return c.json(ev);
  });

  r.post('/:id/outcome', zValidator('json', createMealOutcomeSchema), async (c) => {
    const id = c.req.param('id');
    const outcome = await notFoundHandler(
      services.foodEvent.logOutcome(id, c.req.valid('json')),
    );
    return c.json(outcome);
  });

  return r;
}
