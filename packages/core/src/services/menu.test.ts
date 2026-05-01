import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestHarness, type TestHarness } from '../test-support/index';

describe('menuService', () => {
  let h: TestHarness;
  beforeEach(async () => {
    h = await setupTestHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('suggests a 1-day menu and computes shopping gaps', async () => {
    await h.services.pantry.create({ name: 'Eggs', category: 'protein' });
    await h.services.pantry.create({ name: 'Bread', category: 'carb' });
    await h.services.recipe.create({
      title: 'Egg sandwich',
      ingredients: [
        { name: 'Eggs', optional: false },
        { name: 'Bread', optional: false },
        { name: 'Cheese', optional: false },
      ],
      steps: [],
      tags: [],
    });
    const menu = await h.services.menu.suggest({ days: 1, useAvailableFood: true });
    expect(menu.id).toMatch(/^mnu_/);
    expect(menu.items.length).toBeGreaterThan(0);
    expect(menu.items[0]!.title).toBe('Egg sandwich');
    expect(menu.shoppingGaps.map((g) => g.name)).toContain('Cheese');
    const card = menu.card as { type: string; cardSchemaVersion: number };
    expect(card.type).toBe('menu');
    expect(card.cardSchemaVersion).toBe(1);
  });

  it('returns an empty-friendly card when there are no recipes', async () => {
    const menu = await h.services.menu.suggest({ days: 2, useAvailableFood: true });
    expect(menu.items).toHaveLength(0);
    const card = menu.card as { prepNotes: string | null };
    expect(card.prepNotes).toContain('No saved recipes');
  });

  it('listed menus are newest-first', async () => {
    await h.services.recipe.create({
      title: 'A',
      ingredients: [],
      steps: [],
      tags: [],
    });
    await h.services.menu.suggest({ days: 1, useAvailableFood: true });
    await h.services.menu.suggest({ days: 2, useAvailableFood: true });
    const all = await h.services.menu.list();
    expect(all).toHaveLength(2);
    expect(all[0]!.createdAt >= all[1]!.createdAt).toBe(true);
  });
});
