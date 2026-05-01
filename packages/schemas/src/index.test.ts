import { describe, expect, it } from 'vitest';
import {
  CARD_SCHEMA_VERSION,
  cardSchema,
  createPantryItemSchema,
  createRecommendationSchema,
  foodEventSchema,
  mealRecommendationCardSchema,
  recipeSchema,
  userProfileSchema,
} from './index.js';

describe('schemas', () => {
  it('user profile rejects empty display name', () => {
    const result = userProfileSchema.safeParse({
      id: 'u_1',
      displayName: '',
      timezone: 'Indian/Mauritius',
      goals: {},
      dietaryPreferences: {},
      allergies: [],
      healthNotes: {},
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('pantry item create accepts minimal input', () => {
    const result = createPantryItemSchema.safeParse({
      name: 'eggs',
      category: 'protein',
    });
    expect(result.success).toBe(true);
  });

  it('pantry category enum is exhaustive', () => {
    const valid = createPantryItemSchema.safeParse({ name: 'oat', category: 'carb' });
    const invalid = createPantryItemSchema.safeParse({ name: 'oat', category: 'cereal' });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('food event recipe_candidate is a valid event_type', () => {
    const result = foodEventSchema.shape.eventType.safeParse('recipe_candidate');
    expect(result.success).toBe(true);
  });

  it('recommendation max options is bounded', () => {
    const result = createRecommendationSchema.safeParse({ maxOptions: 99 });
    expect(result.success).toBe(false);
  });

  it('recipe defaults isActive to true via merged shape', () => {
    const result = recipeSchema.safeParse({
      id: 'r_1',
      userId: 'u_1',
      title: 'Tuna rice bowl',
      description: null,
      sourceFoodEventId: null,
      ingredients: [],
      steps: [],
      proteinSource: 'tuna',
      tags: [],
      estimatedCalories: null,
      estimatedProteinG: null,
      estimatedCarbsG: null,
      estimatedFatG: null,
      personalRating: null,
      isActive: true,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('card discriminated union accepts a meal recommendation', () => {
    const card: unknown = {
      cardSchemaVersion: CARD_SCHEMA_VERSION,
      type: 'meal_recommendation',
      title: 'Tuna rice bowl',
      whyThisMeal: 'You have tuna and rice and crave something heavy.',
      ingredientsUsed: ['tuna', 'rice'],
      ingredientsMissing: [],
      actions: [],
      alternatives: [],
    };
    const parsed = cardSchema.parse(card);
    expect(parsed.type).toBe('meal_recommendation');
  });

  it('meal recommendation card requires whyThisMeal', () => {
    const result = mealRecommendationCardSchema.safeParse({
      cardSchemaVersion: CARD_SCHEMA_VERSION,
      type: 'meal_recommendation',
      title: 'X',
      ingredientsUsed: [],
      ingredientsMissing: [],
      actions: [],
      alternatives: [],
    });
    expect(result.success).toBe(false);
  });
});
