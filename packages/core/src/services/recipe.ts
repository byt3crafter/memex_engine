import { and, desc, eq } from 'drizzle-orm';
import { newId, schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import type {
  CreateRecipe,
  Recipe,
  RecipeIngredient,
  RecipeStep,
  UpdateRecipe,
} from '@pantrymind/schemas';
import { nowIso, systemClock, type Clock } from '../util/time';
import { FoodEventNotFoundError, type FoodEventService } from './food-event';
import type { ProfileService } from './profile';

export interface ListRecipesOptions {
  includeInactive?: boolean;
  tag?: string;
  ingredient?: string;
}

export interface PromoteFoodEventOverrides {
  title?: string;
  description?: string;
  tags?: string[];
  proteinSource?: string;
}

export interface RecipeService {
  list(options?: ListRecipesOptions): Promise<Recipe[]>;
  create(input: CreateRecipe): Promise<Recipe>;
  getById(id: string): Promise<Recipe>;
  update(id: string, patch: UpdateRecipe): Promise<Recipe>;
  delete(id: string): Promise<void>;
  promoteFromFoodEvent(
    foodEventId: string,
    overrides?: PromoteFoodEventOverrides,
  ): Promise<Recipe>;
}

export interface RecipeServiceDeps {
  db: Db;
  profile: ProfileService;
  foodEvent: FoodEventService;
  clock?: Clock;
}

export function createRecipeService(deps: RecipeServiceDeps | Db): RecipeService {
  const concrete: RecipeServiceDeps =
    'db' in deps && 'profile' in deps && 'foodEvent' in deps
      ? deps
      : ({
          db: deps as Db,
          profile: undefined as unknown as ProfileService,
          foodEvent: undefined as unknown as FoodEventService,
        });
  const { db } = concrete;
  const clock = concrete.clock ?? systemClock;

  function requireProfile(): ProfileService {
    if (!concrete.profile) throw new Error('RecipeService missing ProfileService dep');
    return concrete.profile;
  }
  function requireFoodEvent(): FoodEventService {
    if (!concrete.foodEvent) throw new Error('RecipeService missing FoodEventService dep');
    return concrete.foodEvent;
  }
  async function userId(): Promise<string> {
    return (await requireProfile().getCurrentProfile()).id;
  }

  function rowToRecipe(row: typeof schema.recipe.$inferSelect): Recipe {
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description,
      sourceFoodEventId: row.sourceFoodEventId,
      ingredients: (row.ingredients ?? []) as RecipeIngredient[],
      steps: (row.steps ?? []) as RecipeStep[],
      proteinSource: row.proteinSource,
      tags: row.tags ?? [],
      estimatedCalories: row.estimatedCalories,
      estimatedProteinG: row.estimatedProteinG,
      estimatedCarbsG: row.estimatedCarbsG,
      estimatedFatG: row.estimatedFatG,
      personalRating: row.personalRating,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function findById(id: string, uid: string) {
    const rows = await db
      .select()
      .from(schema.recipe)
      .where(and(eq(schema.recipe.id, id), eq(schema.recipe.userId, uid)))
      .limit(1)
      .all();
    return rows[0];
  }

  return {
    async list(options = {}) {
      const uid = await userId();
      const conditions = [eq(schema.recipe.userId, uid)];
      if (!options.includeInactive) {
        conditions.push(eq(schema.recipe.isActive, true));
      }
      const rows = await db
        .select()
        .from(schema.recipe)
        .where(and(...conditions))
        .orderBy(desc(schema.recipe.updatedAt))
        .all();
      let result = rows.map(rowToRecipe);
      if (options.tag !== undefined) {
        const tag = options.tag.toLowerCase();
        result = result.filter((r) => r.tags.some((t) => t.toLowerCase() === tag));
      }
      if (options.ingredient !== undefined) {
        const needle = options.ingredient.toLowerCase();
        result = result.filter((r) =>
          r.ingredients.some((i) => i.name.toLowerCase().includes(needle)),
        );
      }
      return result;
    },

    async create(input) {
      const uid = await userId();
      const now = nowIso(clock);
      const id = newId('recipe');
      await db.insert(schema.recipe).values({
        id,
        userId: uid,
        title: input.title,
        description: input.description ?? null,
        sourceFoodEventId: input.sourceFoodEventId ?? null,
        ingredients: input.ingredients,
        steps: input.steps,
        proteinSource: input.proteinSource ?? null,
        tags: input.tags,
        estimatedCalories: input.estimatedCalories ?? null,
        estimatedProteinG: input.estimatedProteinG ?? null,
        estimatedCarbsG: input.estimatedCarbsG ?? null,
        estimatedFatG: input.estimatedFatG ?? null,
        personalRating: input.personalRating ?? null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const row = await findById(id, uid);
      if (!row) throw new Error('recipe disappeared after insert');
      return rowToRecipe(row);
    },

    async getById(id) {
      const uid = await userId();
      const row = await findById(id, uid);
      if (!row) throw new RecipeNotFoundError(id);
      return rowToRecipe(row);
    },

    async update(id, patch) {
      const uid = await userId();
      const existing = await findById(id, uid);
      if (!existing) throw new RecipeNotFoundError(id);
      const now = nowIso(clock);
      const values: Partial<typeof schema.recipe.$inferInsert> = { updatedAt: now };
      if (patch.title !== undefined) values.title = patch.title;
      if (patch.description !== undefined) values.description = patch.description;
      if (patch.sourceFoodEventId !== undefined)
        values.sourceFoodEventId = patch.sourceFoodEventId;
      if (patch.ingredients !== undefined) values.ingredients = patch.ingredients;
      if (patch.steps !== undefined) values.steps = patch.steps;
      if (patch.proteinSource !== undefined) values.proteinSource = patch.proteinSource;
      if (patch.tags !== undefined) values.tags = patch.tags;
      if (patch.estimatedCalories !== undefined)
        values.estimatedCalories = patch.estimatedCalories;
      if (patch.estimatedProteinG !== undefined)
        values.estimatedProteinG = patch.estimatedProteinG;
      if (patch.estimatedCarbsG !== undefined)
        values.estimatedCarbsG = patch.estimatedCarbsG;
      if (patch.estimatedFatG !== undefined) values.estimatedFatG = patch.estimatedFatG;
      if (patch.personalRating !== undefined) values.personalRating = patch.personalRating;
      if (patch.isActive !== undefined) values.isActive = patch.isActive;

      await db
        .update(schema.recipe)
        .set(values)
        .where(and(eq(schema.recipe.id, id), eq(schema.recipe.userId, uid)));
      const updated = await findById(id, uid);
      if (!updated) throw new Error('recipe vanished after update');
      return rowToRecipe(updated);
    },

    async delete(id) {
      const uid = await userId();
      const existing = await findById(id, uid);
      if (!existing) throw new RecipeNotFoundError(id);
      // soft-delete: spec says is_active boolean.
      const now = nowIso(clock);
      await db
        .update(schema.recipe)
        .set({ isActive: false, updatedAt: now })
        .where(and(eq(schema.recipe.id, id), eq(schema.recipe.userId, uid)));
    },

    async promoteFromFoodEvent(foodEventId, overrides = {}) {
      const uid = await userId();
      let event;
      try {
        event = await requireFoodEvent().getById(foodEventId);
      } catch (err) {
        if (err instanceof FoodEventNotFoundError) {
          throw new FoodEventNotFoundError(foodEventId);
        }
        throw err;
      }

      const ingredients: RecipeIngredient[] = event.items.map((i) => ({
        name: i.name,
        quantity: i.quantity ?? null,
        unit: i.unit ?? null,
        optional: false,
      }));
      const proteinItem = event.items.find((i) => i.role === 'protein');
      const proteinSource = overrides.proteinSource ?? proteinItem?.name ?? null;
      const title = overrides.title ?? event.mealName ?? 'Untitled meal';
      const tags = overrides.tags ?? [];
      const description = overrides.description ?? event.notes ?? null;

      // outcome → personal rating if present
      const personalRating = event.outcome?.satisfactionScore ?? null;

      const now = nowIso(clock);
      const id = newId('recipe');
      await db.insert(schema.recipe).values({
        id,
        userId: uid,
        title,
        description,
        sourceFoodEventId: event.id,
        ingredients,
        steps: [],
        proteinSource,
        tags,
        estimatedCalories: null,
        estimatedProteinG: null,
        estimatedCarbsG: null,
        estimatedFatG: null,
        personalRating,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const row = await findById(id, uid);
      if (!row) throw new Error('recipe disappeared after promotion insert');
      return rowToRecipe(row);
    },
  };
}

export class RecipeNotFoundError extends Error {
  readonly code = 'recipe_not_found' as const;
  constructor(public readonly id: string) {
    super(`recipe ${id} not found`);
  }
}
