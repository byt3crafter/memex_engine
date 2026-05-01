import { and, desc, eq } from 'drizzle-orm';
import { newId, schema } from '@pantrymind/db';
import type { Db } from '@pantrymind/db';
import {
  CARD_SCHEMA_VERSION,
  type CreateRecommendation,
  type MealRecommendationCard,
  type Recommendation,
  type RecommendationOption,
  type SelectRecommendation,
} from '@pantrymind/schemas';
import { isoDaysAgo, nowIso, systemClock, type Clock } from '../../util/time';
import type { FoodEventService } from '../food-event';
import type { PantryService } from '../pantry';
import type { ProfileService } from '../profile';
import type { RecipeService } from '../recipe';
import { generateOptions, type RecentFoodEventForRec, type ScoredOption } from './engine';

export const RECOMMENDATION_ENGINE_VERSION_V1 = 'reco@v1' as const;

export interface RecommendationService {
  recommendMeal(input: CreateRecommendation): Promise<Recommendation>;
  getById(id: string): Promise<Recommendation>;
  selectOption(id: string, input: SelectRecommendation): Promise<Recommendation>;
  readonly engineVersion: string;
}

export interface RecommendationServiceDeps {
  db: Db;
  profile: ProfileService;
  pantry: PantryService;
  recipe: RecipeService;
  foodEvent: FoodEventService;
  clock?: Clock;
}

export function createRecommendationService(
  deps: RecommendationServiceDeps | Db,
): RecommendationService {
  const concrete: RecommendationServiceDeps =
    'db' in deps && 'profile' in deps
      ? deps
      : {
          db: deps as Db,
          profile: undefined as unknown as ProfileService,
          pantry: undefined as unknown as PantryService,
          recipe: undefined as unknown as RecipeService,
          foodEvent: undefined as unknown as FoodEventService,
        };
  const { db } = concrete;
  const clock = concrete.clock ?? systemClock;

  function requireDeps(): Required<Omit<RecommendationServiceDeps, 'clock'>> {
    if (!concrete.profile || !concrete.pantry || !concrete.recipe || !concrete.foodEvent) {
      throw new Error('RecommendationService missing dependencies');
    }
    return {
      db: concrete.db,
      profile: concrete.profile,
      pantry: concrete.pantry,
      recipe: concrete.recipe,
      foodEvent: concrete.foodEvent,
    };
  }

  async function userId(): Promise<string> {
    return (await requireDeps().profile.getCurrentProfile()).id;
  }

  async function loadContext(input: CreateRecommendation, uid: string) {
    const reqs = requireDeps();
    const pantry = (await reqs.pantry.list({ isAvailable: true })).filter((p) => p.isAvailable);
    const recipes = await reqs.recipe.list();
    const fromIso = isoDaysAgo(30, clock);
    const recentRaw = await reqs.foodEvent.list({ from: fromIso, limit: 200 });
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
    void uid;
    return {
      cravingText: input.cravingText ?? null,
      preferredProtein: input.preferredProtein ?? null,
      goalContext: input.goalContext ?? null,
      pantry,
      recipes,
      recentEvents: recent,
      maxOptions: input.maxOptions ?? 3,
      now: clock(),
    };
  }

  function toRecommendationOption(o: ScoredOption): RecommendationOption {
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

  function buildCard(recommendationId: string, options: ScoredOption[]): MealRecommendationCard {
    const top = options[0]!;
    const card: MealRecommendationCard = {
      cardSchemaVersion: CARD_SCHEMA_VERSION,
      type: 'meal_recommendation',
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
    return card;
  }

  function rowToRecommendation(row: typeof schema.recommendation.$inferSelect): Recommendation {
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

  async function findById(id: string, uid: string) {
    const rows = await db
      .select()
      .from(schema.recommendation)
      .where(and(eq(schema.recommendation.id, id), eq(schema.recommendation.userId, uid)))
      .limit(1)
      .all();
    return rows[0];
  }

  return {
    engineVersion: RECOMMENDATION_ENGINE_VERSION_V1,

    async recommendMeal(input) {
      const uid = await userId();
      const ctx = await loadContext(input, uid);
      const scored = generateOptions(ctx);
      if (scored.length === 0) {
        // Should not happen unless pantry is completely empty AND no recipes.
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
      const recommendationId = newId('recommendation');
      const now = nowIso(clock);
      const options = scored.map(toRecommendationOption);
      const card = buildCard(recommendationId, scored);

      await db.insert(schema.recommendation).values({
        id: recommendationId,
        userId: uid,
        foodEventId: null,
        requestedAt: now,
        cravingText: input.cravingText ?? null,
        goalContext: input.goalContext ?? null,
        availableFoodSnapshot: ctx.pantry.map((p) => ({
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

      const fresh = await findById(recommendationId, uid);
      if (!fresh) throw new Error('recommendation disappeared after insert');
      return rowToRecommendation(fresh);
    },

    async getById(id) {
      const uid = await userId();
      const row = await findById(id, uid);
      if (!row) throw new RecommendationNotFoundError(id);
      return rowToRecommendation(row);
    },

    async selectOption(id, input) {
      const uid = await userId();
      const row = await findById(id, uid);
      if (!row) throw new RecommendationNotFoundError(id);
      const options = (row.options ?? []) as RecommendationOption[];
      const chosen = options[input.optionIndex];
      if (!chosen) throw new InvalidRecommendationOptionError(id, input.optionIndex);
      await db
        .update(schema.recommendation)
        .set({ selectedOption: chosen })
        .where(eq(schema.recommendation.id, id));
      const fresh = await findById(id, uid);
      if (!fresh) throw new Error('recommendation vanished after select');
      return rowToRecommendation(fresh);
    },
  };
}

export class RecommendationNotFoundError extends Error {
  readonly code = 'recommendation_not_found' as const;
  constructor(public readonly id: string) {
    super(`recommendation ${id} not found`);
  }
}

export class InvalidRecommendationOptionError extends Error {
  readonly code = 'invalid_option_index' as const;
  constructor(
    public readonly id: string,
    public readonly index: number,
  ) {
    super(`recommendation ${id} has no option at index ${index}`);
  }
}

export * from './engine';
