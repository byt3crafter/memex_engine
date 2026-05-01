import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

describe('/api/v1/menus', () => {
  let h: ApiHarness;
  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('POST /suggest returns a menu with shopping gaps', async () => {
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Eggs', category: 'protein' }),
    });
    await h.request('/api/v1/recipes', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Omelet',
        ingredients: [
          { name: 'Eggs' },
          { name: 'Cheese' },
        ],
        steps: [],
        tags: [],
      }),
    });
    const res = await h.request('/api/v1/menus/suggest', {
      method: 'POST',
      body: JSON.stringify({ days: 2, useAvailableFood: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      items: { title: string }[];
      shoppingGaps: { name: string }[];
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.shoppingGaps.map((g) => g.name)).toContain('Cheese');
  });

  it('GET / lists menus', async () => {
    await h.request('/api/v1/menus/suggest', {
      method: 'POST',
      body: JSON.stringify({ days: 1, useAvailableFood: true }),
    });
    const res = await h.request('/api/v1/menus');
    const body = (await res.json()) as { menus: unknown[] };
    expect(body.menus).toHaveLength(1);
  });

  it('GET /:id 404 on missing', async () => {
    const res = await h.request('/api/v1/menus/mnu_missing');
    expect(res.status).toBe(404);
  });
});
