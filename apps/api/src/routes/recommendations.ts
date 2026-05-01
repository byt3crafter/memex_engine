import type { Services } from '@pantrymind/core';
import { InvalidRecommendationOptionError, RecommendationNotFoundError } from '@pantrymind/core';
import { createRecommendationSchema, selectRecommendationSchema } from '@pantrymind/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

export function recommendationsRouter(services: Services): Hono {
  const r = new Hono();

  r.post('/meal', zValidator('json', createRecommendationSchema), async (c) => {
    const rec = await services.recommendation.recommendMeal(c.req.valid('json'));
    return c.json(rec, 201);
  });

  r.get('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const rec = await services.recommendation.getById(id);
      return c.json(rec);
    } catch (err) {
      if (err instanceof RecommendationNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  r.post('/:id/select', zValidator('json', selectRecommendationSchema), async (c) => {
    const id = c.req.param('id');
    try {
      const rec = await services.recommendation.selectOption(id, c.req.valid('json'));
      return c.json(rec);
    } catch (err) {
      if (err instanceof RecommendationNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      if (err instanceof InvalidRecommendationOptionError) {
        throw new HTTPException(400, { message: err.message });
      }
      throw err;
    }
  });

  return r;
}
