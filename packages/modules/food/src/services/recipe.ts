import { and, desc, eq } from 'drizzle-orm';
import { newId, type Db } from '@memex/db';
import { type Clock, nowIso, systemClock } from '@memex/kernel';
import {
  createRecipeSchema,
  type CreateRecipeInput,
  type Recipe,
  type RecipeIngredient,
  type RecipeStep,
  type UpdateRecipe,
} from '../schemas/index';
import * as foodSchema from '../db/schema/index';
import { FoodEventNotFoundError, RecipeNotFoundError } from './errors';
import type { FoodEventService } from './food-event';

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
  list(userId: string, options?: ListRecipesOptions): Promise<Recipe[]>;
  create(userId: string, input: CreateRecipeInput): Promise<Recipe>;
  getById(userId: string, id: string): Promise<Recipe>;
  update(userId: string, id: string, patch: UpdateRecipe): Promise<Recipe>;
  delete(userId: string, id: string): Promise<void>;
  promoteFromFoodEvent(
    userId: string,
    foodEventId: string,
    overrides?: PromoteFoodEventOverrides,
  ): Promise<Recipe>;
}

export interface RecipeServiceDeps {
  db: Db;
  foodEvents: FoodEventService;
  clock?: Clock;
}

export function createRecipeService(deps: RecipeServiceDeps): RecipeService {
  const { db, foodEvents } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToRecipe(row: typeof foodSchema.recipe.$inferSelect): Recipe {
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

  async function findById(userId: string, id: string) {
    const rows = await db
      .select()
      .from(foodSchema.recipe)
      .where(and(eq(foodSchema.recipe.id, id), eq(foodSchema.recipe.userId, userId)))
      .limit(1)
      .all();
    return rows[0];
  }

  return {
    async list(userId, options = {}) {
      const conditions = [eq(foodSchema.recipe.userId, userId)];
      if (!options.includeInactive) {
        conditions.push(eq(foodSchema.recipe.isActive, true));
      }
      const rows = await db
        .select()
        .from(foodSchema.recipe)
        .where(and(...conditions))
        .orderBy(desc(foodSchema.recipe.updatedAt))
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

    async create(userId, rawInput) {
      const input = createRecipeSchema.parse(rawInput);
      const id = newId('rcp');
      const now = nowIso(clock);
      await db.insert(foodSchema.recipe).values({
        id,
        userId,
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
      const row = await findById(userId, id);
      if (!row) throw new Error('recipe disappeared after insert');
      return rowToRecipe(row);
    },

    async getById(userId, id) {
      const row = await findById(userId, id);
      if (!row) throw new RecipeNotFoundError(id);
      return rowToRecipe(row);
    },

    async update(userId, id, patch) {
      const existing = await findById(userId, id);
      if (!existing) throw new RecipeNotFoundError(id);
      const now = nowIso(clock);
      const values: Partial<typeof foodSchema.recipe.$inferInsert> = { updatedAt: now };
      if (patch.title !== undefined) values.title = patch.title;
      if (patch.description !== undefined) values.description = patch.description;
      if (patch.sourceFoodEventId !== undefined) values.sourceFoodEventId = patch.sourceFoodEventId;
      if (patch.ingredients !== undefined) values.ingredients = patch.ingredients;
      if (patch.steps !== undefined) values.steps = patch.steps;
      if (patch.proteinSource !== undefined) values.proteinSource = patch.proteinSource;
      if (patch.tags !== undefined) values.tags = patch.tags;
      if (patch.estimatedCalories !== undefined) values.estimatedCalories = patch.estimatedCalories;
      if (patch.estimatedProteinG !== undefined) values.estimatedProteinG = patch.estimatedProteinG;
      if (patch.estimatedCarbsG !== undefined) values.estimatedCarbsG = patch.estimatedCarbsG;
      if (patch.estimatedFatG !== undefined) values.estimatedFatG = patch.estimatedFatG;
      if (patch.personalRating !== undefined) values.personalRating = patch.personalRating;
      if (patch.isActive !== undefined) values.isActive = patch.isActive;
      await db
        .update(foodSchema.recipe)
        .set(values)
        .where(and(eq(foodSchema.recipe.id, id), eq(foodSchema.recipe.userId, userId)));
      const updated = await findById(userId, id);
      if (!updated) throw new Error('recipe vanished after update');
      return rowToRecipe(updated);
    },

    async delete(userId, id) {
      const existing = await findById(userId, id);
      if (!existing) throw new RecipeNotFoundError(id);
      const now = nowIso(clock);
      await db
        .update(foodSchema.recipe)
        .set({ isActive: false, updatedAt: now })
        .where(and(eq(foodSchema.recipe.id, id), eq(foodSchema.recipe.userId, userId)));
    },

    async promoteFromFoodEvent(userId, foodEventId, overrides = {}) {
      let event;
      try {
        event = await foodEvents.getById(userId, foodEventId);
      } catch (err) {
        if (err instanceof FoodEventNotFoundError) throw new FoodEventNotFoundError(foodEventId);
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
      const personalRating = event.outcome?.satisfactionScore ?? null;
      const id = newId('rcp');
      const now = nowIso(clock);
      await db.insert(foodSchema.recipe).values({
        id,
        userId,
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
      const row = await findById(userId, id);
      if (!row) throw new Error('recipe disappeared after promotion insert');
      return rowToRecipe(row);
    },
  };
}
