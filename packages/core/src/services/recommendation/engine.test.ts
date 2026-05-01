import { describe, expect, it } from 'vitest';
import type { PantryItem, Recipe } from '@pantrymind/schemas';
import { generateOptions, type RecommendationContext } from './engine';

function pantryItem(partial: Partial<PantryItem>): PantryItem {
  return {
    id: partial.id ?? 'pty_' + Math.random().toString(36).slice(2, 8),
    userId: 'usr_test',
    name: partial.name ?? 'item',
    normalizedName: partial.normalizedName ?? (partial.name ?? 'item').toLowerCase(),
    category: partial.category ?? 'other',
    quantity: partial.quantity ?? null,
    unit: partial.unit ?? null,
    expiryDate: partial.expiryDate ?? null,
    source: partial.source ?? 'manual',
    confidence: partial.confidence ?? null,
    isAvailable: partial.isAvailable ?? true,
    createdAt: partial.createdAt ?? '2026-05-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-05-01T00:00:00.000Z',
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
    createdAt: partial.createdAt ?? '2026-05-01T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-05-01T00:00:00.000Z',
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

describe('recommendation engine v1', () => {
  it('returns at least one freestyle option from a basic pantry', () => {
    const opts = generateOptions(
      baseCtx({
        pantry: [
          pantryItem({ name: 'Chicken', category: 'protein' }),
          pantryItem({ name: 'Rice', category: 'carb' }),
          pantryItem({ name: 'Spinach', category: 'vegetable' }),
        ],
      }),
    );
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0]!.title.toLowerCase()).toContain('chicken');
    expect(opts[0]!.recipeId).toBeNull();
  });

  it('boosts a recipe whose ingredients are available', () => {
    const opts = generateOptions(
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
    );
    expect(opts[0]!.title).toBe('Tuna rice bowl');
  });

  it('penalizes recipes eaten in the last week (logged via notes recipeId)', () => {
    const target = recipe({
      id: 'rcp_target',
      title: 'Salmon',
      proteinSource: 'Salmon',
      ingredients: [{ name: 'Salmon', optional: false }],
    });
    const ctx = baseCtx({
      pantry: [pantryItem({ name: 'Salmon', category: 'protein' })],
      recipes: [target],
      recentEvents: [
        {
          event: {
            id: 'fev_x',
            userId: 'usr_test',
            eventType: 'actual_meal',
            occurredAt: new Date('2026-04-29T12:00:00.000Z').toISOString(),
            source: 'api',
            rawText: null,
            imageRefs: null,
            cravingText: null,
            availableFoodContext: null,
            mealName: 'Salmon',
            actualEaten: true,
            eatenByUser: true,
            forPerson: null,
            notes: '{"recipeId":"rcp_target"}',
            createdAt: '2026-04-29T12:00:00.000Z',
            updatedAt: '2026-04-29T12:00:00.000Z',
          },
          items: [],
          outcome: null,
        },
      ],
    });
    const opts = generateOptions(ctx);
    const recipeOption = opts.find((o) => o.recipeId === 'rcp_target')!;
    expect(recipeOption).toBeDefined();
    expect(recipeOption.confidence).toBeLessThanOrEqual(0.75);
    expect(recipeOption.reason.toLowerCase()).toContain('penalty');
  });

  it('craving keywords boost matching recipes', () => {
    const heavyRecipe = recipe({
      title: 'Heavy steak plate',
      proteinSource: 'Steak',
      ingredients: [{ name: 'Steak', optional: false }],
      tags: ['heavy'],
    });
    const lightRecipe = recipe({
      title: 'Light salad',
      proteinSource: 'Lettuce',
      ingredients: [{ name: 'Lettuce', optional: false }],
      tags: ['light'],
    });
    const opts = generateOptions(
      baseCtx({
        pantry: [
          pantryItem({ name: 'Steak', category: 'protein' }),
          pantryItem({ name: 'Lettuce', category: 'vegetable' }),
        ],
        recipes: [heavyRecipe, lightRecipe],
        cravingText: 'something heavy',
      }),
    );
    expect(opts[0]!.title).toBe('Heavy steak plate');
  });
});
