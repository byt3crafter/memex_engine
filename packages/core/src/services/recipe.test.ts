import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestHarness, type TestHarness } from '../test-support/index';
import { RecipeNotFoundError } from './recipe';

describe('recipeService', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await setupTestHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('create + getById round-trips', async () => {
    const created = await h.services.recipe.create({
      title: 'Tuna rice bowl',
      ingredients: [{ name: 'Tuna', optional: false }],
      steps: [{ order: 1, text: 'Open tuna' }],
      tags: ['quick', 'protein'],
    });
    expect(created.id).toMatch(/^rcp_/);
    expect(created.isActive).toBe(true);
    const fetched = await h.services.recipe.getById(created.id);
    expect(fetched.title).toBe('Tuna rice bowl');
  });

  it('list filters out inactive by default', async () => {
    const a = await h.services.recipe.create({
      title: 'A',
      ingredients: [],
      steps: [],
      tags: [],
    });
    await h.services.recipe.create({ title: 'B', ingredients: [], steps: [], tags: [] });
    await h.services.recipe.delete(a.id);
    const active = await h.services.recipe.list();
    expect(active).toHaveLength(1);
    expect(active[0]!.title).toBe('B');
    const all = await h.services.recipe.list({ includeInactive: true });
    expect(all).toHaveLength(2);
  });

  it('promoteFromFoodEvent uses meal_name + items + satisfaction', async () => {
    const ev = await h.services.foodEvent.create({
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'Eggs and toast',
      items: [
        { name: 'Eggs', role: 'protein' },
        { name: 'Toast', role: 'carb' },
      ],
    });
    await h.services.foodEvent.logOutcome(ev.id, {
      foodEventId: ev.id,
      satisfactionScore: 5,
    });
    const recipe = await h.services.recipe.promoteFromFoodEvent(ev.id);
    expect(recipe.title).toBe('Eggs and toast');
    expect(recipe.sourceFoodEventId).toBe(ev.id);
    expect(recipe.ingredients).toHaveLength(2);
    expect(recipe.proteinSource).toBe('Eggs');
    expect(recipe.personalRating).toBe(5);
  });

  it('promoteFromFoodEvent with overrides wins', async () => {
    const ev = await h.services.foodEvent.create({
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'whatever',
      items: [{ name: 'Salmon', role: 'protein' }],
    });
    const recipe = await h.services.recipe.promoteFromFoodEvent(ev.id, {
      title: 'Pan-seared salmon',
      tags: ['dinner', 'omega-3'],
      description: 'Friday classic',
    });
    expect(recipe.title).toBe('Pan-seared salmon');
    expect(recipe.tags).toEqual(['dinner', 'omega-3']);
    expect(recipe.description).toBe('Friday classic');
  });

  it('update changes specific fields', async () => {
    const r = await h.services.recipe.create({
      title: 'X',
      ingredients: [],
      steps: [],
      tags: [],
    });
    const updated = await h.services.recipe.update(r.id, {
      title: 'Y',
      tags: ['fast'],
    });
    expect(updated.title).toBe('Y');
    expect(updated.tags).toEqual(['fast']);
  });

  it('getById on missing throws', async () => {
    await expect(h.services.recipe.getById('rcp_missing')).rejects.toBeInstanceOf(
      RecipeNotFoundError,
    );
  });
});
