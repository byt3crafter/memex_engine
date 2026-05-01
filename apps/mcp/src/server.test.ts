import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callTool, setupMcpHarness, type McpHarness } from './test-helpers';

describe('memex MCP server', () => {
  let h: McpHarness;
  beforeEach(async () => {
    h = await setupMcpHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('lists tools contributed by the kernel + module-food', async () => {
    const list = await h.client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toContain('memex_whoami');
    expect(names).toContain('update_pantry');
    expect(names).toContain('list_available_food');
    expect(names).toContain('recommend_meal');
    expect(names).toContain('log_food_event');
    expect(names).toContain('log_actual_meal');
    expect(names).toContain('log_meal_outcome');
    expect(names).toContain('save_recipe');
    expect(names).toContain('list_recipes');
    expect(names).toContain('suggest_menu');
    expect(names).toContain('get_recent_patterns');
  });

  it('memex_whoami returns the resolved user + modules', async () => {
    const result = await callTool<{
      user: { id: string };
      connection: { kind: string };
      modules: string[];
    }>(h.client, 'memex_whoami', {});
    expect(result.user.id).toBe(h.userId);
    expect(result.connection.kind).toBe('mcp_stdio');
    expect(result.modules).toContain('food');
  });

  it('walks the full food loop entirely through MCP tools', async () => {
    // 1. stock pantry
    await callTool(h.client, 'update_pantry', {
      replace: false,
      items: [
        { name: 'Chicken breast', category: 'protein', quantity: 500, unit: 'g' },
        { name: 'Rice', category: 'carb', quantity: 1000, unit: 'g' },
        { name: 'Broccoli', category: 'vegetable' },
      ],
    });

    const available = await callTool<{ count: number; byCategory: Record<string, unknown[]> }>(
      h.client,
      'list_available_food',
      {},
    );
    expect(available.count).toBe(3);
    expect(available.byCategory['protein']).toBeDefined();

    // 2. recommend
    const reco = await callTool<{
      recommendation: { id: string; engineVersion: string };
      card: { type: string; module: string };
    }>(h.client, 'recommend_meal', {
      cravingText: 'something heavy',
      preferredProtein: 'Chicken breast',
      maxOptions: 3,
    });
    expect(reco.recommendation.engineVersion).toBe('reco@v1');
    expect(reco.card.type).toBe('food.meal_recommendation');
    expect(reco.card.module).toBe('food');

    // 3. log meal
    const logged = await callTool<{ event: { id: string; items: unknown[] } }>(
      h.client,
      'log_actual_meal',
      {
        source: 'assistant',
        mealName: 'Chicken rice bowl',
        items: [
          { name: 'Chicken breast', role: 'protein', quantity: 200, unit: 'g' },
          { name: 'Rice', role: 'carb', quantity: 150, unit: 'g' },
          { name: 'Broccoli', role: 'vegetable' },
        ],
      },
    );
    expect(logged.event.items).toHaveLength(3);

    // 4. outcome
    const outcome = await callTool<{ outcome: { satisfactionScore: number }; hint: string | null }>(
      h.client,
      'log_meal_outcome',
      {
        foodEventId: logged.event.id,
        satisfactionScore: 5,
        energyAfter: 4,
        recipeCandidate: true,
      },
    );
    expect(outcome.outcome.satisfactionScore).toBe(5);
    expect(outcome.hint).toMatch(/save_recipe/);

    // 5. promote to recipe via save_recipe with fromFoodEventId
    const saved = await callTool<{
      recipe: { title: string; proteinSource: string | null; personalRating: number | null };
      promotedFrom: string;
    }>(h.client, 'save_recipe', {
      fromFoodEventId: logged.event.id,
      tags: ['quick', 'protein'],
    });
    expect(saved.recipe.title).toBe('Chicken rice bowl');
    expect(saved.recipe.personalRating).toBe(5);
    expect(saved.promotedFrom).toBe(logged.event.id);

    // 6. list recipes
    const recipes = await callTool<{ count: number; recipes: { title: string }[] }>(
      h.client,
      'list_recipes',
      {},
    );
    expect(recipes.count).toBe(1);
    expect(recipes.recipes[0]!.title).toBe('Chicken rice bowl');

    // 7. suggest menu
    const menu = await callTool<{
      menu: { items: unknown[] };
      card: { type: string; module: string };
    }>(h.client, 'suggest_menu', { days: 2, useAvailableFood: true });
    expect(menu.menu.items.length).toBeGreaterThan(0);
    expect(menu.card.type).toBe('food.menu');

    // 8. patterns stub
    const patterns = await callTool<{
      mealsLogged: number;
      mealsWithOutcomes: number;
      avgSatisfaction: number | null;
    }>(h.client, 'get_recent_patterns', { days: 30 });
    expect(patterns.mealsLogged).toBe(1);
    expect(patterns.mealsWithOutcomes).toBe(1);
    expect(patterns.avgSatisfaction).toBe(5);
  });

  it('rejects an invalid pairing token at server creation', async () => {
    const { resolveMcpAuth } = await import('./auth');
    await expect(resolveMcpAuth(h.kernel, 'mx_not-a-real-token')).rejects.toThrow(
      /invalid or revoked/,
    );
    await expect(resolveMcpAuth(h.kernel, undefined)).rejects.toThrow(/MEMEX_CONNECTION_TOKEN/);
  });
});
