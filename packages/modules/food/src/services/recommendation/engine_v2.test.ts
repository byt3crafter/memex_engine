/**
 * Tests for recommendation engine v2.
 *
 * Engine v2 is pure (no I/O) but takes an async SemanticContext. Tests use
 * in-memory mock implementations of SemanticContext so no model download or
 * vec extension is required — all tests run in every environment.
 */
import { describe, expect, it } from 'vitest';
import type { PantryItem, Recipe } from '../../schemas/index';
import type { RecommendationContext } from './engine';
import { generateOptionsV2, type SemanticContext } from './engine_v2';

// --------------------------------------------------------------------------
// Test fixtures (mirrors engine.test.ts patterns)
// --------------------------------------------------------------------------

function pantryItem(partial: Partial<PantryItem> & { name: string }): PantryItem {
  return {
    id: 'pty_' + Math.random().toString(36).slice(2, 8),
    userId: 'usr_test',
    name: partial.name,
    normalizedName: partial.normalizedName ?? partial.name.toLowerCase(),
    category: partial.category ?? 'other',
    quantity: partial.quantity ?? null,
    unit: partial.unit ?? null,
    expiryDate: partial.expiryDate ?? null,
    source: partial.source ?? 'manual',
    confidence: partial.confidence ?? null,
    isAvailable: partial.isAvailable ?? true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

function recipe(partial: Partial<Recipe> & { title: string }): Recipe {
  return {
    id: partial.id ?? 'rcp_' + Math.random().toString(36).slice(2, 8),
    userId: 'usr_test',
    title: partial.title,
    description: partial.description ?? null,
    sourceFoodEventId: partial.sourceFoodEventId ?? null,
    ingredients: partial.ingredients ?? [],
    steps: partial.steps ?? [],
    proteinSource: partial.proteinSource ?? null,
    tags: partial.tags ?? [],
    estimatedCalories: partial.estimatedCalories ?? null,
    estimatedProteinG: partial.estimatedProteinG ?? null,
    estimatedCarbsG: partial.estimatedCarbsG ?? null,
    estimatedFatG: partial.estimatedFatG ?? null,
    personalRating: partial.personalRating ?? null,
    isActive: partial.isActive ?? true,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

function baseCtx(overrides: Partial<RecommendationContext> = {}): RecommendationContext {
  return {
    cravingText: null,
    preferredProtein: null,
    goalContext: null,
    pantry: [],
    recipes: [],
    recentEvents: [],
    maxOptions: 3,
    now: new Date('2026-05-01T12:00:00.000Z'),
    ...overrides,
  };
}

/** Null semantic context — should fall back to v1 behaviour. */
const nullSemantic: SemanticContext | null = null;

/** Mock semantic context with no useful matches. */
const emptySemantic: SemanticContext = {
  findSimilarEventIds: async () => [],
  findSimilarIngredient: async () => null,
};

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('recommendation engine v2', () => {
  it('with null semantic context produces same ranking as v1', async () => {
    const opts = await generateOptionsV2(
      baseCtx({
        pantry: [
          pantryItem({ name: 'Tuna', category: 'protein' }),
          pantryItem({ name: 'Rice', category: 'carb' }),
        ],
        recipes: [
          recipe({
            title: 'Tuna rice bowl',
            proteinSource: 'Tuna',
            ingredients: [
              { name: 'Tuna', optional: false },
              { name: 'Rice', optional: false },
            ],
          }),
          recipe({
            title: 'Beef stir fry',
            proteinSource: 'Beef',
            ingredients: [
              { name: 'Beef', optional: false },
              { name: 'Broccoli', optional: false },
            ],
          }),
        ],
      }),
      nullSemantic,
    );
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0]!.title).toBe('Tuna rice bowl');
  });

  it('with empty semantic context produces same ranking as v1 (no boosts)', async () => {
    const opts = await generateOptionsV2(
      baseCtx({
        pantry: [
          pantryItem({ name: 'Tuna', category: 'protein' }),
          pantryItem({ name: 'Rice', category: 'carb' }),
        ],
        recipes: [
          recipe({
            id: 'rcp_tuna',
            title: 'Tuna rice bowl',
            proteinSource: 'Tuna',
            ingredients: [
              { name: 'Tuna', optional: false },
              { name: 'Rice', optional: false },
            ],
          }),
        ],
        cravingText: 'something with tuna',
      }),
      emptySemantic,
    );
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0]!.title).toBe('Tuna rice bowl');
  });

  it('semantic craving boost: recipe linked to a high-satisfaction past event is ranked higher', async () => {
    const satisfiedEventId = 'fev_past_stew';
    const recipeFromStew = recipe({
      id: 'rcp_stew',
      title: 'Beef stew',
      sourceFoodEventId: satisfiedEventId,
      proteinSource: 'Beef',
      ingredients: [{ name: 'Beef', optional: false }],
    });
    const otherRecipe = recipe({
      id: 'rcp_salad',
      title: 'Plain salad',
      ingredients: [{ name: 'Lettuce', optional: false }],
    });

    const semanticCtx: SemanticContext = {
      // Query for 'hearty stew' matches the past beef stew event with high satisfaction
      findSimilarEventIds: async (_text, _limit) => [{ eventId: satisfiedEventId, distance: 0.1 }],
      findSimilarIngredient: async () => null,
    };

    const ctx = baseCtx({
      cravingText: 'hearty stew',
      pantry: [pantryItem({ name: 'Beef', category: 'protein' })],
      recipes: [recipeFromStew, otherRecipe],
      recentEvents: [
        {
          event: {
            id: satisfiedEventId,
            userId: 'usr_test',
            eventType: 'actual_meal',
            occurredAt: '2026-04-20T18:00:00.000Z',
            source: 'api',
            rawText: null,
            imageRefs: null,
            cravingText: 'hearty stew',
            availableFoodContext: null,
            mealName: 'Beef stew',
            actualEaten: true,
            eatenByUser: true,
            forPerson: null,
            notes: null,
            createdAt: '2026-04-20T18:00:00.000Z',
            updatedAt: '2026-04-20T18:00:00.000Z',
          },
          items: [{ name: 'Beef', role: 'protein' } as never],
          outcome: {
            id: 'out_stew',
            userId: 'usr_test',
            foodEventId: satisfiedEventId,
            satisfactionScore: 5,
            hungerAfter: null,
            energyAfter: null,
            cravingsAfter: null,
            moodAfter: null,
            notes: null,
            recipeCandidate: false,
            createdAt: '2026-04-20T18:00:00.000Z',
          },
        },
      ],
    });

    const opts = await generateOptionsV2(ctx, semanticCtx);
    expect(opts.length).toBeGreaterThan(0);
    const stewOpt = opts.find((o) => o.recipeId === 'rcp_stew');
    const saladOpt = opts.find((o) => o.recipeId === 'rcp_salad');
    expect(stewOpt).toBeDefined();
    // Stew should be ranked higher than salad due to semantic craving boost
    const stewIdx = opts.indexOf(stewOpt!);
    const saladIdx = saladOpt ? opts.indexOf(saladOpt) : opts.length;
    expect(stewIdx).toBeLessThan(saladIdx);
    // Reason should mention semantic similarity
    expect(stewOpt!.reason.toLowerCase()).toContain('semantically');
  });

  it('semantic ingredient boost: fuzzy pantry match reduces missing-ingredient penalty', async () => {
    const recipeWithChickenThigh = recipe({
      id: 'rcp_thigh',
      title: 'Chicken thigh roast',
      proteinSource: 'Chicken thigh',
      ingredients: [
        { name: 'Chicken thigh', optional: false },
        { name: 'Potatoes', optional: false },
      ],
    });

    // Pantry has "chicken breast" but not "chicken thigh" exactly
    const semanticCtx: SemanticContext = {
      findSimilarEventIds: async () => [],
      // "chicken thigh" semantically matches "chicken breast" in pantry
      findSimilarIngredient: async (needle, _haystack) => {
        if (needle.includes('chicken thigh')) return 'chicken breast';
        return null;
      },
    };

    const opts = await generateOptionsV2(
      baseCtx({
        cravingText: 'chicken roast',
        pantry: [
          pantryItem({
            name: 'Chicken breast',
            category: 'protein',
            normalizedName: 'chicken breast',
          }),
          pantryItem({ name: 'Potatoes', category: 'carb' }),
        ],
        recipes: [recipeWithChickenThigh],
      }),
      semanticCtx,
    );

    const thighOpt = opts.find((o) => o.recipeId === 'rcp_thigh');
    expect(thighOpt).toBeDefined();
    // Reason should reflect the fuzzy match
    expect(thighOpt!.reason.toLowerCase()).toMatch(/semantically covered/);
  });

  it('v2 produces different (higher) scores than v1 when semantic context fires', async () => {
    const satisfiedEventId = 'fev_hotpot';
    const recipeId = 'rcp_hotpot';
    const linkedRecipe = recipe({
      id: recipeId,
      title: 'Spicy hotpot',
      sourceFoodEventId: satisfiedEventId,
      proteinSource: 'Pork',
      ingredients: [{ name: 'Pork', optional: false }],
    });

    const semanticCtx: SemanticContext = {
      findSimilarEventIds: async () => [{ eventId: satisfiedEventId, distance: 0.05 }],
      findSimilarIngredient: async () => null,
    };

    const ctx = baseCtx({
      cravingText: 'spicy soup',
      pantry: [pantryItem({ name: 'Pork', category: 'protein' })],
      recipes: [linkedRecipe],
      recentEvents: [
        {
          event: {
            id: satisfiedEventId,
            userId: 'usr_test',
            eventType: 'actual_meal',
            occurredAt: '2026-04-25T18:00:00.000Z',
            source: 'api',
            rawText: null,
            imageRefs: null,
            cravingText: 'spicy soup',
            availableFoodContext: null,
            mealName: 'Spicy hotpot',
            actualEaten: true,
            eatenByUser: true,
            forPerson: null,
            notes: null,
            createdAt: '2026-04-25T18:00:00.000Z',
            updatedAt: '2026-04-25T18:00:00.000Z',
          },
          items: [],
          outcome: {
            id: 'out_hotpot',
            userId: 'usr_test',
            foodEventId: satisfiedEventId,
            satisfactionScore: 5,
            hungerAfter: null,
            energyAfter: null,
            cravingsAfter: null,
            moodAfter: null,
            notes: null,
            recipeCandidate: false,
            createdAt: '2026-04-25T18:00:00.000Z',
          },
        },
      ],
    });

    const v2Opts = await generateOptionsV2(ctx, semanticCtx);
    const v2Hotpot = v2Opts.find((o) => o.recipeId === recipeId);
    expect(v2Hotpot).toBeDefined();

    // Compare to v1 (empty semantic context)
    const v1Opts = await generateOptionsV2(ctx, emptySemantic);
    const v1Hotpot = v1Opts.find((o) => o.recipeId === recipeId);
    expect(v1Hotpot).toBeDefined();

    // v2 should score higher for this recipe due to semantic boost
    expect(v2Hotpot!.score).toBeGreaterThan(v1Hotpot!.score);
  });
});
