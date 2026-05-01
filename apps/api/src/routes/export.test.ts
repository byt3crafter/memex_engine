import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

describe('GET /api/v1/export/json', () => {
  let h: ApiHarness;
  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('returns a complete bundle including pantry, recipes, and food events', async () => {
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Eggs', category: 'protein' }),
    });
    await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'actual_meal',
        source: 'api',
        mealName: 'Eggs',
        items: [{ name: 'Eggs', role: 'protein' }],
      }),
    });
    const res = await h.request('/api/v1/export/json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      profile: { id: string };
      pantry: unknown[];
      foodEvents: unknown[];
      recipes: unknown[];
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.profile.id).toMatch(/^usr_/);
    expect(body.pantry).toHaveLength(1);
    expect(body.foodEvents).toHaveLength(1);
    expect(body.recipes).toHaveLength(0);
  });
});
