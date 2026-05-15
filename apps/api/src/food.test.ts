/**
 * End-to-end test for the Demeter (food) module mounted under
 * /api/v1/food/*. Walks the entire assistant-native loop:
 *
 *   bootstrap → pair-complete → token →
 *   create pantry → recommend meal → log meal →
 *   log outcome → promote recipe → suggest menu → export
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from './test-helpers';

interface PairedHarness {
  h: ApiHarness;
  token: string;
  userId: string;
}

async function pairUser(): Promise<PairedHarness> {
  const h = await setupApiHarness();
  const bootstrap = await h.withBootstrap('/admin/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ displayName: 'Dovik', timezone: 'Indian/Mauritius' }),
  });
  const bootstrapBody = (await bootstrap.json()) as {
    pairing: { pairingCode: string };
    founder: { id: string };
  };
  const complete = await h.request('/api/v1/connections/pair-complete', {
    method: 'POST',
    body: JSON.stringify({ code: bootstrapBody.pairing.pairingCode }),
  });
  const completeBody = (await complete.json()) as { token: string; userId: string };
  return { h, token: completeBody.token, userId: completeBody.userId };
}

describe('module-food (Demeter) under /api/v1/food/*', () => {
  let p: PairedHarness;

  beforeEach(async () => {
    p = await pairUser();
  });
  afterEach(async () => {
    await p.h.cleanup();
  });

  it('module is registered with the kernel as `food`/Demeter', () => {
    expect(p.h.kernel.modules.ids()).toContain('food');
    const m = p.h.kernel.modules.require('food');
    expect(m.module.manifest.codename).toBe('Demeter');
    expect(m.module.manifest.version).toBe('0.2.0');
  });

  it('contributes its meal_recommendation + menu cards to the registry', () => {
    expect(p.h.kernel.cards.has('food.meal_recommendation')).toBe(true);
    expect(p.h.kernel.cards.has('food.menu')).toBe(true);
  });

  it('walks the full food loop end-to-end', async () => {
    const { h, token } = p;

    // 1. stock pantry
    for (const item of [
      { name: 'Chicken breast', category: 'protein', quantity: 500, unit: 'g' },
      { name: 'Rice', category: 'carb', quantity: 1000, unit: 'g' },
      { name: 'Broccoli', category: 'vegetable' },
    ]) {
      const res = await h.withToken(token, '/api/v1/food/pantry/items', {
        method: 'POST',
        body: JSON.stringify(item),
      });
      expect(res.status).toBe(201);
    }

    const list = await h.withToken(token, '/api/v1/food/pantry');
    const listBody = (await list.json()) as { items: { name: string }[] };
    expect(listBody.items).toHaveLength(3);

    // 2. recommend a meal
    const reco = await h.withToken(token, '/api/v1/food/recommendations/meal', {
      method: 'POST',
      body: JSON.stringify({
        cravingText: 'something heavy and protein-rich',
        preferredProtein: 'Chicken breast',
        maxOptions: 3,
      }),
    });
    expect(reco.status).toBe(201);
    const recoBody = (await reco.json()) as {
      id: string;
      engineVersion: string;
      options: { title: string }[];
      card: { type: string; module: string; cardSchemaVersion: number };
    };
    expect(recoBody.engineVersion).toBe('reco@v1');
    expect(recoBody.options.length).toBeGreaterThan(0);
    expect(recoBody.card.type).toBe('food.meal_recommendation');
    expect(recoBody.card.module).toBe('food');

    // 3. log actual meal
    const ev = await h.withToken(token, '/api/v1/food/food-events', {
      method: 'POST',
      body: JSON.stringify({
        eventType: 'actual_meal',
        source: 'assistant',
        mealName: 'Chicken rice bowl',
        items: [
          { name: 'Chicken breast', role: 'protein', quantity: 200, unit: 'g' },
          { name: 'Rice', role: 'carb', quantity: 150, unit: 'g' },
          { name: 'Broccoli', role: 'vegetable' },
        ],
      }),
    });
    expect(ev.status).toBe(201);
    const evBody = (await ev.json()) as { id: string; items: unknown[] };
    expect(evBody.items).toHaveLength(3);

    // 4. log outcome
    const out = await h.withToken(token, `/api/v1/food/food-events/${evBody.id}/outcome`, {
      method: 'POST',
      body: JSON.stringify({
        foodEventId: evBody.id,
        satisfactionScore: 5,
        energyAfter: 4,
        recipeCandidate: true,
      }),
    });
    expect(out.status).toBe(200);
    const outBody = (await out.json()) as { satisfactionScore: number };
    expect(outBody.satisfactionScore).toBe(5);

    // 5. promote to recipe
    const promote = await h.withToken(token, `/api/v1/food/recipes/from-food-event/${evBody.id}`, {
      method: 'POST',
      body: JSON.stringify({ tags: ['quick', 'protein'] }),
    });
    expect(promote.status).toBe(201);
    const promoteBody = (await promote.json()) as {
      title: string;
      proteinSource: string | null;
      personalRating: number | null;
    };
    expect(promoteBody.title).toBe('Chicken rice bowl');
    expect(promoteBody.proteinSource).toBe('Chicken breast');
    expect(promoteBody.personalRating).toBe(5);

    // 6. suggest a 2-day menu
    const menu = await h.withToken(token, '/api/v1/food/menus/suggest', {
      method: 'POST',
      body: JSON.stringify({ days: 2, useAvailableFood: true }),
    });
    expect(menu.status).toBe(201);
    const menuBody = (await menu.json()) as { items: unknown[]; shoppingGaps: unknown[] };
    expect(menuBody.items.length).toBeGreaterThan(0);

    // 7. export the food slice
    const exp = await h.withToken(token, '/api/v1/food/export');
    expect(exp.status).toBe(200);
    const expBody = (await exp.json()) as {
      pantry: unknown[];
      foodEvents: unknown[];
      recipes: unknown[];
      menus: unknown[];
    };
    expect(expBody.pantry).toHaveLength(3);
    expect(expBody.foodEvents).toHaveLength(1);
    expect(expBody.recipes).toHaveLength(1);
    expect(expBody.menus).toHaveLength(1);
  });

  it('two users have isolated pantries', async () => {
    const { h, token: tokenA } = p;

    // Stock Dovik's pantry.
    await h.withToken(tokenA, '/api/v1/food/pantry/items', {
      method: 'POST',
      body: JSON.stringify({ name: 'Chicken', category: 'protein' }),
    });

    // Create a second user via the kernel directly + pair them.
    const userB = await h.kernel.services.users.create({
      displayName: 'Other User',
      timezone: 'UTC',
    });
    const start = await h.kernel.services.pairing.start(userB.id, {
      clientName: 'B-cli',
      clientKind: 'rest_api',
      scopes: [],
      expiresInSeconds: 600,
    });
    const completeB = await h.kernel.services.pairing.complete({ code: start.pairingCode });

    // B's pantry must be empty.
    const listB = await h.withToken(completeB.token, '/api/v1/food/pantry');
    const listBBody = (await listB.json()) as { items: unknown[] };
    expect(listBBody.items).toHaveLength(0);

    // A still sees their own item.
    const listA = await h.withToken(tokenA, '/api/v1/food/pantry');
    const listABody = (await listA.json()) as { items: unknown[] };
    expect(listABody.items).toHaveLength(1);
  });
});
