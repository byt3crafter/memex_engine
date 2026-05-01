import type { PromoteFoodEventOverrides, Services } from '@pantrymind/core';
import { FoodEventNotFoundError, RecipeNotFoundError } from '@pantrymind/core';
import { createRecipeSchema, updateRecipeSchema } from '@pantrymind/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';

const listQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  tag: z.string().min(1).optional(),
  ingredient: z.string().min(1).optional(),
});

const promoteOverridesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  proteinSource: z.string().optional(),
});

export function recipesRouter(services: Services): Hono {
  const r = new Hono();

  r.get('/', zValidator('query', listQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const opts: { includeInactive?: boolean; tag?: string; ingredient?: string } = {};
    if (q.includeInactive !== undefined) opts.includeInactive = q.includeInactive;
    if (q.tag !== undefined) opts.tag = q.tag;
    if (q.ingredient !== undefined) opts.ingredient = q.ingredient;
    const recipes = await services.recipe.list(opts);
    return c.json({ recipes });
  });

  r.post('/', zValidator('json', createRecipeSchema), async (c) => {
    const recipe = await services.recipe.create(c.req.valid('json'));
    return c.json(recipe, 201);
  });

  r.post('/from-food-event/:foodEventId', async (c) => {
    const id = c.req.param('foodEventId');
    let raw: unknown = {};
    try {
      raw = await c.req.json();
    } catch {
      raw = {};
    }
    const parseResult = promoteOverridesSchema.safeParse(raw);
    if (!parseResult.success) {
      const err: ZodError = parseResult.error;
      throw new HTTPException(400, { message: err.message });
    }
    const parsed = parseResult.data;
    const overrides: PromoteFoodEventOverrides = {};
    if (parsed.title !== undefined) overrides.title = parsed.title;
    if (parsed.description !== undefined) overrides.description = parsed.description;
    if (parsed.tags !== undefined) overrides.tags = parsed.tags;
    if (parsed.proteinSource !== undefined) overrides.proteinSource = parsed.proteinSource;
    try {
      const recipe = await services.recipe.promoteFromFoodEvent(id, overrides);
      return c.json(recipe, 201);
    } catch (err) {
      if (err instanceof FoodEventNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  r.get('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const recipe = await services.recipe.getById(id);
      return c.json(recipe);
    } catch (err) {
      if (err instanceof RecipeNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  r.patch('/:id', zValidator('json', updateRecipeSchema), async (c) => {
    const id = c.req.param('id');
    try {
      const recipe = await services.recipe.update(id, c.req.valid('json'));
      return c.json(recipe);
    } catch (err) {
      if (err instanceof RecipeNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    try {
      await services.recipe.delete(id);
    } catch (err) {
      if (err instanceof RecipeNotFoundError) {
        throw new HTTPException(404, { message: err.message });
      }
      throw err;
    }
    return c.body(null, 204);
  });

  return r;
}
