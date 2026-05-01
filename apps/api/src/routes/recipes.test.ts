import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

describe('/api/v1/recipes', () => {
  let h: ApiHarness;

  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('POST creates and GET lists', async () => {
    const created = await h.request('/api/v1/recipes', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Quick eggs',
        ingredients: [{ name: 'Eggs' }, { name: 'Salt' }],
        steps: [{ order: 1, text: 'Crack and scramble' }],
        tags: ['breakfast'],
      }),
    });
    expect(created.status).toBe(201);

    const list = await h.request('/api/v1/recipes');
    const body = (await list.json()) as { recipes: { title: string }[] };
    expect(body.recipes).toHaveLength(1);
    expect(body.recipes[0]!.title).toBe('Quick eggs');
  });

  it('POST /from-food-event/:id promotes', async () => {
    const ev = await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'actual_meal',
        source: 'api',
        mealName: 'Salmon plate',
        items: [
          { name: 'Salmon', role: 'protein' },
          { name: 'Asparagus', role: 'vegetable' },
        ],
      }),
    });
    const evBody = (await ev.json()) as { id: string };

    const promoted = await h.request(`/api/v1/recipes/from-food-event/${evBody.id}`, {
      method: 'POST',
      body: JSON.stringify({ tags: ['dinner'] }),
    });
    expect(promoted.status).toBe(201);
    const promotedBody = (await promoted.json()) as {
      title: string;
      proteinSource: string | null;
      tags: string[];
      sourceFoodEventId: string;
    };
    expect(promotedBody.title).toBe('Salmon plate');
    expect(promotedBody.proteinSource).toBe('Salmon');
    expect(promotedBody.tags).toEqual(['dinner']);
    expect(promotedBody.sourceFoodEventId).toBe(evBody.id);
  });

  it('DELETE soft-deactivates and excludes from default list', async () => {
    const created = await h.request('/api/v1/recipes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Throwaway', ingredients: [], steps: [], tags: [] }),
    });
    const cBody = (await created.json()) as { id: string };
    const del = await h.request(`/api/v1/recipes/${cBody.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const list = await h.request('/api/v1/recipes');
    const body = (await list.json()) as { recipes: unknown[] };
    expect(body.recipes).toHaveLength(0);

    const allList = await h.request('/api/v1/recipes?includeInactive=true');
    const allBody = (await allList.json()) as { recipes: unknown[] };
    expect(allBody.recipes).toHaveLength(1);
  });

  it('GET /:id 404 on missing', async () => {
    const res = await h.request('/api/v1/recipes/rcp_missing');
    expect(res.status).toBe(404);
  });
});
