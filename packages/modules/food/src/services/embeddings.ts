/**
 * Embedding service for Demeter — local sentence-transformer pipeline using
 * @huggingface/transformers (Xenova/all-MiniLM-L6-v2, 384-dim).
 *
 * Design principles:
 * - Module-level singleton: model is loaded once on first use.
 * - Graceful no-op: if the model or sqlite-vec extension fails to load,
 *   all methods return null/empty and reco@v1 continues unaffected.
 * - Embed-on-write: recipe.create, promoteFromFoodEvent, and
 *   foodEvent.create (actual_meal) trigger async embedding that never
 *   blocks the write path.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Client } from '@libsql/client';
import { loadVecExtension, type Db } from '@memex/db';
import * as foodSchema from '../db/schema/index';
import type { FoodEventWithDetails } from './food-event';
import type {
  EstimateSource,
  FoodEventItemRole,
  FoodEventSource,
  FoodEventType,
  Recipe,
  RecipeIngredient,
  RecipeStep,
} from '../schemas/index';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

// --------------------------------------------------------------------------
// Embedder singleton
// --------------------------------------------------------------------------

type EmbedderFn = (text: string) => Promise<Float32Array>;

let embedderState:
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<EmbedderFn | null> }
  | { status: 'ready'; fn: EmbedderFn }
  | { status: 'failed' } = { status: 'idle' };

async function loadEmbedder(): Promise<EmbedderFn | null> {
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    // In environments without network access / disk quota, require opt-in.
    if (process.env['MEMEX_ALLOW_MODEL_DOWNLOAD'] !== '1') {
      env.allowRemoteModels = false;
    }
    const pipe = await pipeline('feature-extraction', MODEL_ID, { dtype: 'fp32' });
    return async (text: string): Promise<Float32Array> => {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      return output.data as Float32Array;
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[memex/food] embedder unavailable (${msg}); semantic recall disabled`);
    return null;
  }
}

export async function getEmbedder(): Promise<EmbedderFn | null> {
  if (embedderState.status === 'ready') return embedderState.fn;
  if (embedderState.status === 'failed') return null;
  if (embedderState.status === 'loading') return embedderState.promise;

  const promise = loadEmbedder().then((fn) => {
    if (fn) {
      embedderState = { status: 'ready', fn };
    } else {
      embedderState = { status: 'failed' };
    }
    return fn;
  });
  embedderState = { status: 'loading', promise };
  return promise;
}

/** Reset the singleton — test helper only. */
export function resetEmbedderForTest(): void {
  embedderState = { status: 'idle' };
}

// --------------------------------------------------------------------------
// Vec table init
// --------------------------------------------------------------------------

let vecAvailable: boolean | null = null;

async function ensureVecTables(db: Db, client: Client): Promise<boolean> {
  if (vecAvailable !== null) return vecAvailable;
  const loaded = await loadVecExtension(client);
  if (!loaded) {
    vecAvailable = false;
    return false;
  }
  try {
    await db.run(
      sql`CREATE VIRTUAL TABLE IF NOT EXISTS recipe_vec (recipe_id TEXT PRIMARY KEY, embedding FLOAT[${sql.raw(String(EMBEDDING_DIM))}]) USING vec0`,
    );
    await db.run(
      sql`CREATE VIRTUAL TABLE IF NOT EXISTS food_event_vec (food_event_id TEXT PRIMARY KEY, embedding FLOAT[${sql.raw(String(EMBEDDING_DIM))}]) USING vec0`,
    );
    vecAvailable = true;
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[memex/food] vec table creation failed (${msg}); vector queries disabled`);
    vecAvailable = false;
    return false;
  }
}

/** Reset vec state — test helper only. */
export function resetVecStateForTest(): void {
  vecAvailable = null;
}

// --------------------------------------------------------------------------
// Text helpers
// --------------------------------------------------------------------------

function recipeToText(recipe: Recipe): string {
  const parts: string[] = [recipe.title];
  if (recipe.description) parts.push(recipe.description);
  if (recipe.proteinSource) parts.push(recipe.proteinSource);
  const ingredientNames = recipe.ingredients.map((i) => i.name).join(', ');
  if (ingredientNames) parts.push(ingredientNames);
  if (recipe.tags.length > 0) parts.push(recipe.tags.join(' '));
  return parts.join('. ');
}

function foodEventToText(event: FoodEventWithDetails): string {
  const parts: string[] = [];
  if (event.mealName) parts.push(event.mealName);
  if (event.cravingText) parts.push(event.cravingText);
  const itemNames = event.items.map((i) => i.name).join(', ');
  if (itemNames) parts.push(itemNames);
  if (event.rawText) parts.push(event.rawText);
  return parts.join('. ') || 'meal';
}

// --------------------------------------------------------------------------
// Public embedding helpers (used by engine_v2 and write hooks)
// --------------------------------------------------------------------------

export async function embedText(text: string): Promise<number[] | null> {
  const embed = await getEmbedder();
  if (!embed) return null;
  try {
    const arr = await embed(text);
    return Array.from(arr);
  } catch {
    return null;
  }
}

export async function embedRecipe(recipe: Recipe): Promise<number[] | null> {
  return embedText(recipeToText(recipe));
}

export async function embedFoodEvent(event: FoodEventWithDetails): Promise<number[] | null> {
  return embedText(foodEventToText(event));
}

// --------------------------------------------------------------------------
// Embedding service
// --------------------------------------------------------------------------

export interface SimilarEventMatch {
  eventId: string;
  distance: number;
}

export interface EmbeddingService {
  isAvailable(): boolean;
  embedAndStoreRecipe(recipe: Recipe): Promise<void>;
  embedAndStoreFoodEvent(event: FoodEventWithDetails): Promise<void>;
  findSimilarEventIds(queryText: string, limit: number): Promise<SimilarEventMatch[]>;
  findSimilarMeals(
    userId: string,
    queryText: string,
    limit: number,
  ): Promise<FoodEventWithDetails[]>;
  findSimilarRecipes(userId: string, queryText: string, limit: number): Promise<Recipe[]>;
}

export interface EmbeddingServiceDeps {
  db: Db;
  client: Client;
}

export function createEmbeddingService(deps: EmbeddingServiceDeps): EmbeddingService {
  const { db, client } = deps;

  // Kick off vec init eagerly but never block construction.
  ensureVecTables(db, client).catch(() => {
    /* logged inside ensureVecTables */
  });

  async function vecReady(): Promise<boolean> {
    return ensureVecTables(db, client);
  }

  return {
    isAvailable() {
      return vecAvailable === true;
    },

    async embedAndStoreRecipe(recipe) {
      if (!(await vecReady())) return;
      const vec = await embedRecipe(recipe);
      if (!vec) return;
      try {
        const f32 = new Float32Array(vec);
        await db.run(
          sql`INSERT OR REPLACE INTO recipe_vec (recipe_id, embedding) VALUES (${recipe.id}, ${f32})`,
        );
      } catch (err) {
        console.warn(
          `[memex/food] recipe embed store failed (${recipe.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async embedAndStoreFoodEvent(event) {
      if (event.eventType !== 'actual_meal') return;
      if (!(await vecReady())) return;
      const vec = await embedFoodEvent(event);
      if (!vec) return;
      try {
        const f32 = new Float32Array(vec);
        await db.run(
          sql`INSERT OR REPLACE INTO food_event_vec (food_event_id, embedding) VALUES (${event.id}, ${f32})`,
        );
      } catch (err) {
        console.warn(
          `[memex/food] food_event embed store failed (${event.id}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async findSimilarEventIds(queryText, limit) {
      if (!(await vecReady())) return [];
      const queryVec = await embedText(queryText);
      if (!queryVec) return [];
      const f32 = new Float32Array(queryVec);
      try {
        const rows = await db.values<[string, number]>(sql`
          SELECT food_event_id, distance
          FROM food_event_vec
          WHERE embedding MATCH ${f32} AND k = ${limit * 5}
          ORDER BY distance
        `);
        return rows.map(([eventId, distance]) => ({
          eventId: eventId as string,
          distance: distance as number,
        }));
      } catch {
        return [];
      }
    },

    async findSimilarMeals(userId, queryText, limit) {
      const candidates = await this.findSimilarEventIds(queryText, limit);
      if (candidates.length === 0) return [];

      const ids = candidates.map((c) => c.eventId) as [string, ...string[]];
      const eventRows = await db
        .select()
        .from(foodSchema.foodEvent)
        .where(and(eq(foodSchema.foodEvent.userId, userId), inArray(foodSchema.foodEvent.id, ids)))
        .all();

      const byId = new Map(eventRows.map((r) => [r.id, r]));
      const ordered = candidates
        .map((c) => byId.get(c.eventId))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .slice(0, limit);

      const results: FoodEventWithDetails[] = [];
      for (const row of ordered) {
        const items = await db
          .select()
          .from(foodSchema.foodEventItem)
          .where(eq(foodSchema.foodEventItem.foodEventId, row.id))
          .all();
        const outcomeRows = await db
          .select()
          .from(foodSchema.mealOutcome)
          .where(eq(foodSchema.mealOutcome.foodEventId, row.id))
          .limit(1)
          .all();
        results.push({
          id: row.id,
          userId: row.userId,
          eventType: row.eventType as FoodEventType,
          occurredAt: row.occurredAt,
          source: row.source as FoodEventSource,
          rawText: row.rawText,
          imageRefs: (row.imageRefs ?? null) as FoodEventWithDetails['imageRefs'],
          cravingText: row.cravingText,
          availableFoodContext: (row.availableFoodContext ??
            null) as FoodEventWithDetails['availableFoodContext'],
          mealName: row.mealName,
          actualEaten: row.actualEaten,
          eatenByUser: row.eatenByUser,
          forPerson: row.forPerson,
          notes: row.notes,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          items: items.map((i) => ({
            id: i.id,
            foodEventId: i.foodEventId,
            name: i.name,
            normalizedName: i.normalizedName,
            role: i.role as FoodEventItemRole,
            quantity: i.quantity,
            unit: i.unit,
            caloriesEstimated: i.caloriesEstimated,
            proteinGEstimated: i.proteinGEstimated,
            carbsGEstimated: i.carbsGEstimated,
            fatGEstimated: i.fatGEstimated,
            estimateConfidence: i.estimateConfidence,
            estimateSource: (i.estimateSource ?? null) as EstimateSource | null,
            createdAt: i.createdAt,
          })),
          outcome: outcomeRows[0]
            ? {
                id: outcomeRows[0].id,
                userId: outcomeRows[0].userId,
                foodEventId: outcomeRows[0].foodEventId,
                satisfactionScore: outcomeRows[0].satisfactionScore,
                hungerAfter: outcomeRows[0].hungerAfter,
                energyAfter: outcomeRows[0].energyAfter,
                cravingsAfter: outcomeRows[0].cravingsAfter,
                moodAfter: outcomeRows[0].moodAfter,
                notes: outcomeRows[0].notes,
                recipeCandidate: outcomeRows[0].recipeCandidate,
                createdAt: outcomeRows[0].createdAt,
              }
            : null,
        });
      }
      return results;
    },

    async findSimilarRecipes(userId, queryText, limit) {
      if (!(await vecReady())) return [];
      const queryVec = await embedText(queryText);
      if (!queryVec) return [];
      const f32 = new Float32Array(queryVec);
      let candidateIds: string[] = [];
      try {
        const rows = await db.values<[string, number]>(sql`
          SELECT recipe_id, distance
          FROM recipe_vec
          WHERE embedding MATCH ${f32} AND k = ${limit * 5}
          ORDER BY distance
        `);
        candidateIds = rows.map(([id]) => id as string);
      } catch {
        return [];
      }
      if (candidateIds.length === 0) return [];

      const rows = await db
        .select()
        .from(foodSchema.recipe)
        .where(
          and(
            eq(foodSchema.recipe.userId, userId),
            eq(foodSchema.recipe.isActive, true),
            inArray(foodSchema.recipe.id, candidateIds as [string, ...string[]]),
          ),
        )
        .all();

      const byId = new Map(rows.map((r) => [r.id, r]));
      return candidateIds
        .map((id) => byId.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .slice(0, limit)
        .map(
          (r): Recipe => ({
            id: r.id,
            userId: r.userId,
            title: r.title,
            description: r.description,
            sourceFoodEventId: r.sourceFoodEventId,
            ingredients: (r.ingredients ?? []) as RecipeIngredient[],
            steps: (r.steps ?? []) as RecipeStep[],
            proteinSource: r.proteinSource,
            tags: r.tags ?? [],
            estimatedCalories: r.estimatedCalories,
            estimatedProteinG: r.estimatedProteinG,
            estimatedCarbsG: r.estimatedCarbsG,
            estimatedFatG: r.estimatedFatG,
            personalRating: r.personalRating,
            isActive: r.isActive,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }),
        );
    },
  };
}
