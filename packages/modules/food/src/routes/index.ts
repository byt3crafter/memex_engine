/**
 * Demeter HTTP surface — mounted at /api/v1/food/* by the kernel.
 *
 * Every handler reads the authenticated user from c.get('user').id and
 * passes it explicitly to services. There is no singleton/auto-create
 * fallback: the kernel's auth middleware guarantees a user is present
 * by the time the handler runs.
 */
import {
  bulkPantryUpdateSchema,
  createFoodEventItemSchema,
  createFoodEventSchema,
  createMealOutcomeSchema,
  createPantryItemSchema,
  createRecipeSchema,
  createRecommendationSchema,
  foodEventTypeSchema,
  pantryCategorySchema,
  selectRecommendationSchema,
  suggestMenuSchema,
  updateFoodEventSchema,
  updatePantryItemSchema,
  updateRecipeSchema,
  type CreateRecipeInput,
  type CreateRecommendationInput,
  type SuggestMenuRawInput,
} from '../schemas/index';
import { isoDateTimeSchema, type User } from '@memex/schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z, ZodError } from 'zod';
import {
  FoodEventNotFoundError,
  InvalidRecommendationOptionError,
  MenuPlanNotFoundError,
  PantryItemNotFoundError,
  RecipeNotFoundError,
  RecommendationNotFoundError,
  type FoodServices,
  type ListFoodEventsOptions,
  type ListPantryOptions,
  type ListRecipesOptions,
} from '../services/index';

declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

const promoteOverridesSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  proteinSource: z.string().optional(),
});

const pantryListQuerySchema = z.object({
  category: pantryCategorySchema.optional(),
  isAvailable: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  search: z.string().min(1).optional(),
});

const foodEventListQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  type: foodEventTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const recipeListQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  tag: z.string().min(1).optional(),
  ingredient: z.string().min(1).optional(),
});

const addItemsSchema = z.object({
  items: z.array(createFoodEventItemSchema).min(1).max(50),
});

export function foodRoutes(services: FoodServices): Hono {
  const r = new Hono();

  // ── pantry ─────────────────────────────────────────────────────────
  r.get('/pantry', zValidator('query', pantryListQuerySchema), async (c) => {
    const userId = c.get('user').id;
    const q = c.req.valid('query');
    const filter: ListPantryOptions = {};
    if (q.category !== undefined) filter.category = q.category;
    if (q.isAvailable !== undefined) filter.isAvailable = q.isAvailable;
    if (q.search !== undefined) filter.search = q.search;
    return c.json({ items: await services.pantry.list(userId, filter) });
  });

  r.post('/pantry/items', zValidator('json', createPantryItemSchema), async (c) => {
    const item = await services.pantry.create(c.get('user').id, c.req.valid('json'));
    return c.json(item, 201);
  });

  r.patch('/pantry/items/:id', zValidator('json', updatePantryItemSchema), async (c) => {
    try {
      const item = await services.pantry.update(
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json'),
      );
      return c.json(item);
    } catch (err) {
      if (err instanceof PantryItemNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.delete('/pantry/items/:id', async (c) => {
    try {
      await services.pantry.delete(c.get('user').id, c.req.param('id'));
    } catch (err) {
      if (err instanceof PantryItemNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
    return c.body(null, 204);
  });

  r.post('/pantry/bulk-update', zValidator('json', bulkPantryUpdateSchema), async (c) => {
    return c.json(await services.pantry.bulkUpdate(c.get('user').id, c.req.valid('json')));
  });

  // ── food events ────────────────────────────────────────────────────
  r.post('/food-events', zValidator('json', createFoodEventSchema), async (c) => {
    return c.json(await services.foodEvents.create(c.get('user').id, c.req.valid('json')), 201);
  });

  r.get('/food-events', zValidator('query', foodEventListQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const opts: ListFoodEventsOptions = {};
    if (q.from !== undefined) opts.from = q.from;
    if (q.to !== undefined) opts.to = q.to;
    if (q.type !== undefined) opts.eventType = q.type;
    if (q.limit !== undefined) opts.limit = q.limit;
    return c.json({ events: await services.foodEvents.list(c.get('user').id, opts) });
  });

  r.get('/food-events/:id', async (c) => {
    try {
      return c.json(await services.foodEvents.getById(c.get('user').id, c.req.param('id')));
    } catch (err) {
      if (err instanceof FoodEventNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.patch('/food-events/:id', zValidator('json', updateFoodEventSchema), async (c) => {
    try {
      return c.json(
        await services.foodEvents.update(c.get('user').id, c.req.param('id'), c.req.valid('json')),
      );
    } catch (err) {
      if (err instanceof FoodEventNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.post('/food-events/:id/items', zValidator('json', addItemsSchema), async (c) => {
    try {
      const ev = await services.foodEvents.addItems(
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json').items,
      );
      return c.json(ev);
    } catch (err) {
      if (err instanceof FoodEventNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.post('/food-events/:id/outcome', zValidator('json', createMealOutcomeSchema), async (c) => {
    try {
      return c.json(
        await services.foodEvents.logOutcome(
          c.get('user').id,
          c.req.param('id'),
          c.req.valid('json'),
        ),
      );
    } catch (err) {
      if (err instanceof FoodEventNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  // ── recipes ────────────────────────────────────────────────────────
  r.get('/recipes', zValidator('query', recipeListQuerySchema), async (c) => {
    const q = c.req.valid('query');
    const opts: ListRecipesOptions = {};
    if (q.includeInactive !== undefined) opts.includeInactive = q.includeInactive;
    if (q.tag !== undefined) opts.tag = q.tag;
    if (q.ingredient !== undefined) opts.ingredient = q.ingredient;
    return c.json({ recipes: await services.recipes.list(c.get('user').id, opts) });
  });

  r.post('/recipes', zValidator('json', createRecipeSchema), async (c) => {
    return c.json(
      await services.recipes.create(c.get('user').id, c.req.valid('json') as CreateRecipeInput),
      201,
    );
  });

  r.post('/recipes/from-food-event/:foodEventId', async (c) => {
    let raw: unknown = {};
    try {
      raw = await c.req.json();
    } catch {
      raw = {};
    }
    const parseResult = promoteOverridesSchema.safeParse(raw);
    if (!parseResult.success) {
      const e: ZodError = parseResult.error;
      throw new HTTPException(400, { message: e.message });
    }
    const overrides: {
      title?: string;
      description?: string;
      tags?: string[];
      proteinSource?: string;
    } = {};
    if (parseResult.data.title !== undefined) overrides.title = parseResult.data.title;
    if (parseResult.data.description !== undefined)
      overrides.description = parseResult.data.description;
    if (parseResult.data.tags !== undefined) overrides.tags = parseResult.data.tags;
    if (parseResult.data.proteinSource !== undefined)
      overrides.proteinSource = parseResult.data.proteinSource;
    try {
      const recipe = await services.recipes.promoteFromFoodEvent(
        c.get('user').id,
        c.req.param('foodEventId'),
        overrides,
      );
      return c.json(recipe, 201);
    } catch (err) {
      if (err instanceof FoodEventNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.get('/recipes/:id', async (c) => {
    try {
      return c.json(await services.recipes.getById(c.get('user').id, c.req.param('id')));
    } catch (err) {
      if (err instanceof RecipeNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.patch('/recipes/:id', zValidator('json', updateRecipeSchema), async (c) => {
    try {
      return c.json(
        await services.recipes.update(c.get('user').id, c.req.param('id'), c.req.valid('json')),
      );
    } catch (err) {
      if (err instanceof RecipeNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.delete('/recipes/:id', async (c) => {
    try {
      await services.recipes.delete(c.get('user').id, c.req.param('id'));
    } catch (err) {
      if (err instanceof RecipeNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
    return c.body(null, 204);
  });

  // ── recommendations ────────────────────────────────────────────────
  r.post('/recommendations/meal', zValidator('json', createRecommendationSchema), async (c) => {
    return c.json(
      await services.recommendations.recommendMeal(
        c.get('user').id,
        c.req.valid('json') as CreateRecommendationInput,
      ),
      201,
    );
  });

  r.get('/recommendations/:id', async (c) => {
    try {
      return c.json(await services.recommendations.getById(c.get('user').id, c.req.param('id')));
    } catch (err) {
      if (err instanceof RecommendationNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  r.post(
    '/recommendations/:id/select',
    zValidator('json', selectRecommendationSchema),
    async (c) => {
      try {
        return c.json(
          await services.recommendations.selectOption(
            c.get('user').id,
            c.req.param('id'),
            c.req.valid('json'),
          ),
        );
      } catch (err) {
        if (err instanceof RecommendationNotFoundError)
          throw new HTTPException(404, { message: err.message });
        if (err instanceof InvalidRecommendationOptionError)
          throw new HTTPException(400, { message: err.message });
        throw err;
      }
    },
  );

  // ── menus ──────────────────────────────────────────────────────────
  r.post('/menus/suggest', zValidator('json', suggestMenuSchema), async (c) => {
    const input = c.req.valid('json') as SuggestMenuRawInput;
    return c.json(
      await services.menus.suggest(c.get('user').id, suggestMenuSchema.parse(input)),
      201,
    );
  });

  r.get('/menus', async (c) => c.json({ menus: await services.menus.list(c.get('user').id) }));

  r.get('/menus/:id', async (c) => {
    try {
      return c.json(await services.menus.getById(c.get('user').id, c.req.param('id')));
    } catch (err) {
      if (err instanceof MenuPlanNotFoundError)
        throw new HTTPException(404, { message: err.message });
      throw err;
    }
  });

  // ── export (food slice) ────────────────────────────────────────────
  r.get('/export', async (c) => {
    const userId = c.get('user').id;
    return c.json({
      pantry: await services.pantry.list(userId),
      foodEvents: await services.foodEvents.list(userId, { limit: 10_000 }),
      recipes: await services.recipes.list(userId, { includeInactive: true }),
      menus: await services.menus.list(userId),
    });
  });

  return r;
}
