import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

describe('/api/v1/pantry', () => {
  let h: ApiHarness;

  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('POST creates an item', async () => {
    const res = await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Chicken breast', category: 'protein', quantity: 500, unit: 'g' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; normalizedName: string; isAvailable: boolean };
    expect(body.id).toMatch(/^pty_/);
    expect(body.normalizedName).toBe('chicken breast');
    expect(body.isAvailable).toBe(true);
  });

  it('GET lists items with query filters', async () => {
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Chicken', category: 'protein' }),
    });
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rice', category: 'carb' }),
    });

    const all = await h.request('/api/v1/pantry');
    const allBody = (await all.json()) as { items: { name: string }[] };
    expect(allBody.items).toHaveLength(2);

    const proteins = await h.request('/api/v1/pantry?category=protein');
    const proteinsBody = (await proteins.json()) as { items: { name: string }[] };
    expect(proteinsBody.items).toHaveLength(1);
    expect(proteinsBody.items[0]!.name).toBe('Chicken');
  });

  it('PATCH updates an item', async () => {
    const created = await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Eggs', category: 'protein' }),
    });
    const createdBody = (await created.json()) as { id: string };

    const patched = await h.request(`/api/v1/pantry/items/${createdBody.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 6, isAvailable: false }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { quantity: number; isAvailable: boolean };
    expect(patchedBody.quantity).toBe(6);
    expect(patchedBody.isAvailable).toBe(false);
  });

  it('PATCH unknown id returns 404', async () => {
    const res = await h.request('/api/v1/pantry/items/pty_missing', {
      method: 'PATCH',
      body: JSON.stringify({ quantity: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE removes an item and returns 204', async () => {
    const created = await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Eggs', category: 'protein' }),
    });
    const createdBody = (await created.json()) as { id: string };

    const del = await h.request(`/api/v1/pantry/items/${createdBody.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const list = await h.request('/api/v1/pantry');
    const listBody = (await list.json()) as { items: unknown[] };
    expect(listBody.items).toHaveLength(0);
  });

  it('POST /bulk-update merges and reports counts', async () => {
    await h.request('/api/v1/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Eggs', category: 'protein' }),
    });
    const res = await h.request('/api/v1/pantry/bulk-update', {
      method: 'POST',
      body: JSON.stringify({
        items: [
          { name: 'eggs', category: 'protein', quantity: 12, unit: 'pcs' },
          { name: 'Rice', category: 'carb' },
          { name: 'Spinach', category: 'vegetable' },
        ],
        replace: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      created: number;
      updated: number;
      deleted: number;
      totalAfter: number;
    };
    expect(body.created).toBe(2);
    expect(body.updated).toBe(1);
    expect(body.totalAfter).toBe(3);
  });
});
