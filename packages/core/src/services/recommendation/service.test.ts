import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestHarness, type TestHarness } from '../../test-support/index';
import { RECOMMENDATION_ENGINE_VERSION_V1, RecommendationNotFoundError } from './index';

describe('recommendationService', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await setupTestHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('produces options from pantry alone and persists the snapshot', async () => {
    await h.services.pantry.create({ name: 'Chicken', category: 'protein' });
    await h.services.pantry.create({ name: 'Rice', category: 'carb' });
    await h.services.pantry.create({ name: 'Broccoli', category: 'vegetable' });

    const rec = await h.services.recommendation.recommendMeal({
      cravingText: 'something filling',
      maxOptions: 3,
    });
    expect(rec.id).toMatch(/^rec_/);
    expect(rec.engineVersion).toBe(RECOMMENDATION_ENGINE_VERSION_V1);
    expect(rec.options.length).toBeGreaterThan(0);
    expect(rec.availableFoodSnapshot.length).toBe(3);
    expect(rec.recommendedTitle.toLowerCase()).toContain('chicken');
    const card = rec.card as { type: string; cardSchemaVersion: number };
    expect(card.type).toBe('meal_recommendation');
    expect(card.cardSchemaVersion).toBe(1);
  });

  it('select sets selectedOption', async () => {
    await h.services.pantry.create({ name: 'Eggs', category: 'protein' });
    await h.services.pantry.create({ name: 'Bread', category: 'carb' });
    const rec = await h.services.recommendation.recommendMeal({ maxOptions: 2 });
    const updated = await h.services.recommendation.selectOption(rec.id, { optionIndex: 0 });
    expect(updated.selectedOption?.title).toBe(rec.options[0]!.title);
  });

  it('getById on missing throws', async () => {
    await expect(h.services.recommendation.getById('rec_missing')).rejects.toBeInstanceOf(
      RecommendationNotFoundError,
    );
  });
});
