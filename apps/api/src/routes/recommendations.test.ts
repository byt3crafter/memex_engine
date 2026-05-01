import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

describe('/api/v1/recommendations', () => {
  let h: ApiHarness;
  beforeEach(async () => {
    h = await setupApiHarness();
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Chicken', category: 'protein' }),
    });
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rice', category: 'carb' }),
    });
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Broccoli', category: 'vegetable' }),
    });
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('POST /meal returns options + a card', async () => {
    const res = await h.request('/api/v1/recommendations/meal', {
      method: 'POST',
      body: JSON.stringify({ cravingText: 'something filling', maxOptions: 3 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      engineVersion: string;
      options: { title: string }[];
      card: { type: string; cardSchemaVersion: number };
    };
    expect(body.id).toMatch(/^rec_/);
    expect(body.engineVersion).toBe('reco@v1');
    expect(body.options.length).toBeGreaterThan(0);
    expect(body.card.type).toBe('meal_recommendation');
    expect(body.card.cardSchemaVersion).toBe(1);
  });

  it('POST /:id/select records the selected option', async () => {
    const created = await h.request('/api/v1/recommendations/meal', {
      method: 'POST',
      body: JSON.stringify({ maxOptions: 3 }),
    });
    const createdBody = (await created.json()) as { id: string; options: { title: string }[] };

    const sel = await h.request(`/api/v1/recommendations/${createdBody.id}/select`, {
      method: 'POST',
      body: JSON.stringify({ optionIndex: 0 }),
    });
    expect(sel.status).toBe(200);
    const selBody = (await sel.json()) as { selectedOption: { title: string } | null };
    expect(selBody.selectedOption?.title).toBe(createdBody.options[0]!.title);
  });

  it('select with bad index → 400', async () => {
    const created = await h.request('/api/v1/recommendations/meal', {
      method: 'POST',
      body: JSON.stringify({ maxOptions: 1 }),
    });
    const createdBody = (await created.json()) as { id: string };
    const res = await h.request(`/api/v1/recommendations/${createdBody.id}/select`, {
      method: 'POST',
      body: JSON.stringify({ optionIndex: 99 }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /:id 404 on missing', async () => {
    const res = await h.request('/api/v1/recommendations/rec_missing');
    expect(res.status).toBe(404);
  });
});
