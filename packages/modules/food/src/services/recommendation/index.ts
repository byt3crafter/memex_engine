import { and, eq } from 'drizzle-orm';
import { newId, type Db } from '@memex/db';
import { CARD_SCHEMA_VERSION } from '@memex/schemas';
import { type Clock, isoDaysAgo, nowIso, systemClock } from '@memex/kernel';
import {
  createRecommendationSchema,
  type CreateRecommendationInput,
  type Recommendation,
  type RecommendationOption,
  type SelectRecommendation,
} from '../../schemas/index';
import * as foodSchema from '../../db/schema/index';
import { InvalidRecommendationOptionError, RecommendationNotFoundError } from '../errors';
import type { FoodEventService } from '../food-event';
import type { PantryService } from '../pantry';
import type { RecipeService } from '../recipe';
import { generateOptions, type RecentFoodEventForRec, type ScoredOption } from './engine';

export const RECOMMENDATION_ENGINE_VERSION_V1 = 'reco@v1' as const;

export interface RecommendationService {
  recommendMeal(userId: string, input: CreateRecommendationInput): Promise<Recommendation>;
  getById(userId: string, id: string): Promise<Recommendation>;
  selectOption(userId: string, id: string, input: SelectRecommendation): Promise<Recommendation>;
  readonly engineVersion: string;
}

export interface RecommendationServiceDeps {
  db: Db;
  pantry: PantryService;
  recipes: RecipeService;
  foodEvents: FoodEventService;
  clock?: Clock;
}

export function createRecommendationService(
  deps: RecommendationServiceDeps,
): RecommendationService {
  const { db, pantry, recipes, foodEvents } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToRecommendation(row: typeof foodSchema.recommendation.$inferSelect): Recommendation {
    return {
      id: row.id,
      userId: row.userId,
      foodEventId: row.foodEventId,
      requestedAt: row.requestedAt,
      cravingText: row.cravingText,
      goalContext: (row.goalContext ?? null) as Recommendation['goalContext'],
      availableFoodSnapshot: (row.availableFoodSnapshot ??
        []) as Recommendation['availableFoodSnapshot'],
      engineVersion: row.engineVersion,
      recommendedTitle: row.recommendedTitle,
      recommendationReason: row.recommendationReason,
      options: (row.options ?? []) as RecommendationOption[],
      selectedOption: (row.selectedOption ?? null) as RecommendationOption | null,
      card: row.card,
      createdAt: row.createdAt,
    };
  }

  async function findById(userId: string, id: string) {
    const rows = await db
      .select()
      .from(foodSchema.recommendation)
      .where(
        and(eq(foodSchema.recommendation.id, id), eq(foodSchema.recommendation.userId, userId)),
      )
      .limit(1)
      .all();
    return rows[0];
  }

  function toOption(o: ScoredOption): RecommendationOption {
    return {
      title: o.title,
      reason: o.reason,
      proteinSource: o.proteinSource,
      ingredientsUsed: o.ingredientsUsed,
      ingredientsMissing: o.ingredientsMissing,
      prepTimeMinutes: o.prepTimeMinutes,
      caloriesEstimated: o.caloriesEstimated,
      proteinGEstimated: o.proteinGEstimated,
      carbsGEstimated: o.carbsGEstimated,
      fatGEstimated: o.fatGEstimated,
      confidence: o.confidence,
      recipeId: o.recipeId,
      items: o.items,
    };
  }

  function buildCard(recommendationId: string, options: ScoredOption[]) {
    const top = options[0]!;
    return {
      cardSchemaVersion: CARD_SCHEMA_VERSION,
      type: 'food.meal_recommendation',
      module: 'food',
      title: top.title,
      whyThisMeal: top.reason,
      ingredientsUsed: top.ingredientsUsed,
      ingredientsMissing: top.ingredientsMissing,
      proteinSource: top.proteinSource,
      prepTimeMinutes: top.prepTimeMinutes,
      caloriesEstimated: top.caloriesEstimated,
      proteinGEstimated: top.proteinGEstimated,
      carbsGEstimated: top.carbsGEstimated,
      fatGEstimated: top.fatGEstimated,
      confidence: top.confidence,
      alternatives: options.slice(1).map((o) => o.title),
      recommendationId,
      optionIndex: 0,
      actions: [
        {
          id: 'log_eaten',
          label: 'I ate this',
          kind: 'log_eaten',
          payload: { recommendationId, optionIndex: 0 },
        },
        {
          id: 'save_recipe',
          label: 'Save as recipe',
          kind: 'save_recipe',
          payload: { recommendationId },
        },
        {
          id: 'add_to_shopping_list',
          label: 'Add missing to shopping list',
          kind: 'add_to_shopping_list',
          payload: { items: top.ingredientsMissing },
        },
      ],
    };
  }

  return {
    engineVersion: RECOMMENDATION_ENGINE_VERSION_V1,

    async recommendMeal(userId, rawInput) {
      const input = createRecommendationSchema.parse(rawInput);
      const pantryList = (await pantry.list(userId, { isAvailable: true })).filter(
        (p) => p.isAvailable,
      );
      const recipesList = await recipes.list(userId);
      const fromIso = isoDaysAgo(30, clock);
      const recentRaw = await foodEvents.list(userId, { from: fromIso, limit: 200 });
      const recent: RecentFoodEventForRec[] = recentRaw.map((r) => ({
        event: {
          id: r.id,
          userId: r.userId,
          eventType: r.eventType,
          occurredAt: r.occurredAt,
          source: r.source,
          rawText: r.rawText,
          imageRefs: r.imageRefs,
          cravingText: r.cravingText,
          availableFoodContext: r.availableFoodContext,
          mealName: r.mealName,
          actualEaten: r.actualEaten,
          eatenByUser: r.eatenByUser,
          forPerson: r.forPerson,
          notes: r.notes,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        },
        items: r.items,
        outcome: r.outcome,
      }));
      const ctx = {
        cravingText: input.cravingText ?? null,
        preferredProtein: input.preferredProtein ?? null,
        goalContext: input.goalContext ?? null,
        pantry: pantryList,
        recipes: recipesList,
        recentEvents: recent,
        maxOptions: input.maxOptions,
        now: clock(),
      };
      const scored = generateOptions(ctx);
      if (scored.length === 0) {
        scored.push({
          title: 'Stock the kitchen',
          reason: 'No available pantry items or saved recipes — add some first.',
          proteinSource: null,
          ingredientsUsed: [],
          ingredientsMissing: [],
          prepTimeMinutes: null,
          caloriesEstimated: null,
          proteinGEstimated: null,
          carbsGEstimated: null,
          fatGEstimated: null,
          confidence: 0,
          recipeId: null,
          items: [],
          score: 0,
        });
      }
      const id = newId('rec');
      const now = nowIso(clock);
      const options = scored.map(toOption);
      const card = buildCard(id, scored);
      await db.insert(foodSchema.recommendation).values({
        id,
        userId,
        foodEventId: null,
        requestedAt: now,
        cravingText: input.cravingText ?? null,
        goalContext: input.goalContext ?? null,
        availableFoodSnapshot: pantryList.map((p) => ({
          id: p.id,
          name: p.name,
          normalizedName: p.normalizedName,
          category: p.category,
          quantity: p.quantity,
          unit: p.unit,
        })),
        engineVersion: RECOMMENDATION_ENGINE_VERSION_V1,
        recommendedTitle: scored[0]!.title,
        recommendationReason: scored[0]!.reason,
        options,
        selectedOption: null,
        card,
        createdAt: now,
      });
      const fresh = await findById(userId, id);
      if (!fresh) throw new Error('recommendation disappeared after insert');
      return rowToRecommendation(fresh);
    },

    async getById(userId, id) {
      const row = await findById(userId, id);
      if (!row) throw new RecommendationNotFoundError(id);
      return rowToRecommendation(row);
    },

    async selectOption(userId, id, input) {
      const row = await findById(userId, id);
      if (!row) throw new RecommendationNotFoundError(id);
      const options = (row.options ?? []) as RecommendationOption[];
      const chosen = options[input.optionIndex];
      if (!chosen) throw new InvalidRecommendationOptionError(id, input.optionIndex);
      await db
        .update(foodSchema.recommendation)
        .set({ selectedOption: chosen })
        .where(eq(foodSchema.recommendation.id, id));
      const fresh = await findById(userId, id);
      return rowToRecommendation(fresh!);
    },
  };
}

export * from './engine';
