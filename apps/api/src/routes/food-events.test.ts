import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

interface FoodEventResponse {
  id: string;
  mealName: string | null;
  items: { id: string; name: string }[];
  outcome: { satisfactionScore: number | null } | null;
}

describe('/api/v1/food-events', () => {
  let h: ApiHarness;

  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('POST creates an event with items', async () => {
    const res = await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'actual_meal',
        source: 'api',
        mealName: 'Tuna sandwich',
        items: [
          { name: 'Tuna', role: 'protein' },
          { name: 'Bread', role: 'carb' },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as FoodEventResponse;
    expect(body.id).toMatch(/^fev_/);
    expect(body.items).toHaveLength(2);
    expect(body.outcome).toBeNull();
  });

  it('GET returns events newest first', async () => {
    await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'craving', source: 'api', items: [] }),
    });
    await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'actual_meal', source: 'api', items: [] }),
    });
    const res = await h.request('/api/v1/food-events');
    const body = (await res.json()) as { events: { eventType: string }[] };
    expect(body.events).toHaveLength(2);
    expect(body.events[0]!.eventType).toBe('actual_meal');
  });

  it('GET ?type filters', async () => {
    await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'craving', source: 'api', items: [] }),
    });
    await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({ eventType: 'actual_meal', source: 'api', items: [] }),
    });
    const res = await h.request('/api/v1/food-events?type=craving');
    const body = (await res.json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('POST /:id/items appends', async () => {
    const created = await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'actual_meal',
        source: 'api',
        items: [{ name: 'Eggs', role: 'protein' }],
      }),
    });
    const createdBody = (await created.json()) as FoodEventResponse;
    const res = await h.request(`/api/v1/food-events/${createdBody.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [{ name: 'Toast', role: 'carb' }] }),
    });
    const body = (await res.json()) as FoodEventResponse;
    expect(body.items).toHaveLength(2);
  });

  it('POST /:id/outcome upserts', async () => {
    const created = await h.request('/api/v1/food-events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'actual_meal',
        source: 'api',
        items: [{ name: 'Eggs', role: 'protein' }],
      }),
    });
    const createdBody = (await created.json()) as FoodEventResponse;
    const res = await h.request(`/api/v1/food-events/${createdBody.id}/outcome`, {
      method: 'POST',
      body: JSON.stringify({
        foodEventId: createdBody.id,
        satisfactionScore: 5,
        energyAfter: 4,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { satisfactionScore: number };
    expect(body.satisfactionScore).toBe(5);
  });

  it('GET /:id 404 on unknown id', async () => {
    const res = await h.request('/api/v1/food-events/fev_missing');
    expect(res.status).toBe(404);
  });
});
