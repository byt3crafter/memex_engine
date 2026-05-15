/**
 * Recommendation engine v2 — extends v1 with semantic recall.
 *
 * Takes the same RecommendationContext as v1, plus a SemanticContext that
 * provides two optional recall callbacks:
 *
 *   1. findSimilarEvents(text, limit) — KNN over food_event_vec.
 *      Used to detect craving→satisfied meal history, then boost recipes
 *      that came from those events (sourceFoodEventId match).
 *
 *   2. findSimilarIngredients(needles, haystack, threshold) — cosine
 *      similarity within a shared embedding space to detect fuzzy matches
 *      like "chicken thigh" ≈ "chicken breast". Used to expand pantry-overlap
 *      scoring beyond exact normalized-name matching.
 *
 * When SemanticContext callbacks return empty (vec unavailable / embedder not
 * loaded), v2 degrades to v1 scoring with no behaviour change.
 *
 * The engine is pure: given the same inputs it produces the same outputs.
 * Callers own I/O and persistence; the engine only scores.
 */
import type { SimilarEventMatch } from '../embeddings';
import { generateOptions, type RecommendationContext, type ScoredOption } from './engine';
import { normalizeName } from '@memex/kernel';

export interface SemanticContext {
  /**
   * Returns food_event ids and distances ordered by similarity to queryText.
   * Must be fast — called once per recommendMeal call.
   */
  findSimilarEventIds(queryText: string, limit: number): Promise<SimilarEventMatch[]>;

  /**
   * For each needle ingredient name, returns the most similar pantry item
   * name if similarity exceeds threshold, or null if none qualifies.
   * threshold is cosine distance (lower = more similar; use ~0.4 for fuzzy).
   */
  findSimilarIngredient(needle: string, haystack: string[]): Promise<string | null>;
}

const HIGH_SATISFACTION = 4;
const SEMANTIC_CRAVING_BOOST = 0.12;
const SEMANTIC_INGREDIENT_BOOST = 0.08;

/**
 * Run v2 scoring: v1 baseline + semantic boosts.
 *
 * The semanticCtx is allowed to be null — in that case the function delegates
 * entirely to v1 and stamps v2 in the engine version only when both v1 and
 * semantic context cooperate.
 */
export async function generateOptionsV2(
  ctx: RecommendationContext,
  semanticCtx: SemanticContext | null,
): Promise<ScoredOption[]> {
  // Always start with v1 scores as the base.
  const base = generateOptions(ctx);

  if (!semanticCtx || !ctx.cravingText) {
    return base;
  }

  // --------------------------------------------------------------------------
  // Semantic recall: craving → past satisfied events → boost their source recipes
  // --------------------------------------------------------------------------
  const similarEvents = await semanticCtx.findSimilarEventIds(ctx.cravingText, 10);

  // Collect food_event ids where outcome was highly satisfying.
  const highSatEventIds = new Set<string>();
  for (const match of similarEvents) {
    const ev = ctx.recentEvents.find((e) => e.event.id === match.eventId);
    if (ev && (ev.outcome?.satisfactionScore ?? 0) >= HIGH_SATISFACTION) {
      highSatEventIds.add(match.eventId);
    }
  }

  // Map food_event id → source recipe ids that were promoted from those events.
  const semanticBoostedRecipeIds = new Set<string>();
  if (highSatEventIds.size > 0) {
    for (const recipe of ctx.recipes) {
      if (recipe.sourceFoodEventId && highSatEventIds.has(recipe.sourceFoodEventId)) {
        semanticBoostedRecipeIds.add(recipe.id);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Semantic ingredient expansion: fuzzy pantry-overlap for saved recipes
  // --------------------------------------------------------------------------
  const pantryNames = ctx.pantry.filter((p) => p.isAvailable).map((p) => p.normalizedName);

  const result: ScoredOption[] = [];
  for (const option of base) {
    let boost = 0;
    const reasonAdditions: string[] = [];

    // Craving-history boost.
    if (option.recipeId && semanticBoostedRecipeIds.has(option.recipeId)) {
      boost += SEMANTIC_CRAVING_BOOST;
      reasonAdditions.push('semantically similar to a meal you loved');
    }

    // Fuzzy ingredient-pantry boost: try to find a match for each missing ingredient.
    if (option.recipeId && option.ingredientsMissing.length > 0 && pantryNames.length > 0) {
      let fuzzyMatches = 0;
      for (const missing of option.ingredientsMissing) {
        const similar = await semanticCtx.findSimilarIngredient(
          normalizeName(missing),
          pantryNames,
        );
        if (similar) {
          fuzzyMatches++;
        }
      }
      if (fuzzyMatches > 0) {
        const perMatch = SEMANTIC_INGREDIENT_BOOST / Math.max(1, option.ingredientsMissing.length);
        boost += perMatch * fuzzyMatches;
        reasonAdditions.push(`~${fuzzyMatches} missing ingredient(s) semantically covered`);
      }
    }

    const augmented: ScoredOption = {
      ...option,
      score: option.score + boost,
      confidence: Math.max(0, Math.min(1, option.confidence + boost)),
      reason:
        reasonAdditions.length > 0
          ? `${option.reason}; ${reasonAdditions.join('; ')}`
          : option.reason,
    };
    result.push(augmented);
  }

  result.sort((a, b) => b.score - a.score);
  return result;
}
