import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestHarness, type TestHarness } from '../test-support/index';
import { FoodEventNotFoundError } from './food-event';

describe('foodEventService', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await setupTestHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('creates an event with items and returns details', async () => {
    const ev = await h.services.foodEvent.create({
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'Chicken rice bowl',
      items: [
        { name: 'Chicken breast', role: 'protein', quantity: 200, unit: 'g' },
        { name: 'Rice', role: 'carb', quantity: 150, unit: 'g' },
      ],
    });
    expect(ev.id).toMatch(/^fev_/);
    expect(ev.mealName).toBe('Chicken rice bowl');
    expect(ev.items).toHaveLength(2);
    expect(ev.items[0]!.normalizedName).toBe('chicken breast');
    expect(ev.outcome).toBeNull();
  });

  it('lists events newest first with type filter', async () => {
    await h.services.foodEvent.create({
      eventType: 'craving',
      source: 'assistant',
      cravingText: 'sweet',
      items: [],
    });
    await h.services.foodEvent.create({
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'eggs',
      items: [],
    });

    const all = await h.services.foodEvent.list();
    expect(all).toHaveLength(2);
    expect(all[0]!.eventType).toBe('actual_meal');

    const cravings = await h.services.foodEvent.list({ eventType: 'craving' });
    expect(cravings).toHaveLength(1);
  });

  it('addItems appends and bumps updatedAt', async () => {
    const ev = await h.services.foodEvent.create({
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'snack',
      items: [{ name: 'apple', role: 'fruit' }],
    });
    const beforeUpdated = ev.updatedAt;
    const updated = await h.services.foodEvent.addItems(ev.id, [
      { name: 'peanut butter', role: 'fat' },
    ]);
    expect(updated.items).toHaveLength(2);
    expect(updated.updatedAt >= beforeUpdated).toBe(true);
  });

  it('logOutcome creates and then upserts the outcome', async () => {
    const ev = await h.services.foodEvent.create({
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'tuna sandwich',
      items: [{ name: 'tuna', role: 'protein' }],
    });
    const first = await h.services.foodEvent.logOutcome(ev.id, {
      foodEventId: ev.id,
      satisfactionScore: 4,
      energyAfter: 4,
    });
    expect(first.satisfactionScore).toBe(4);

    const second = await h.services.foodEvent.logOutcome(ev.id, {
      foodEventId: ev.id,
      satisfactionScore: 5,
      hungerAfter: 1,
      recipeCandidate: true,
    });
    expect(second.satisfactionScore).toBe(5);
    expect(second.hungerAfter).toBe(1);
    expect(second.recipeCandidate).toBe(true);

    const fresh = await h.services.foodEvent.getById(ev.id);
    expect(fresh.outcome?.satisfactionScore).toBe(5);
  });

  it('getById throws FoodEventNotFoundError on unknown id', async () => {
    await expect(h.services.foodEvent.getById('fev_missing')).rejects.toBeInstanceOf(
      FoodEventNotFoundError,
    );
  });
});
