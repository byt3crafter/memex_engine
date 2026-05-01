import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyKernelMigrations, applyMigrationsFromFolder, createDb } from '@memex/db';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFoodServices, type FoodServices } from './index';

interface H {
  cleanup: () => Promise<void>;
  services: FoodServices;
  userId: string;
}

async function setup(): Promise<H> {
  const tempDir = await mkdtemp(join(tmpdir(), 'memex-patterns-'));
  const dbPath = join(tempDir, 'test.db');
  const { db, client } = createDb({ url: `file:${dbPath}` });
  await applyKernelMigrations(db);
  const here = dirname(fileURLToPath(import.meta.url));
  await applyMigrationsFromFolder(db, join(here, '..', '..', 'drizzle'));

  // Seed a user directly via raw insert (kernel.userService is what
  // apps would use; the food module's tests stay self-contained).
  const { schema } = await import('@memex/db');
  const now = new Date().toISOString();
  const userId = 'usr_test_' + Math.random().toString(36).slice(2, 10);
  await db.insert(schema.user).values({
    id: userId,
    email: null,
    displayName: 'T',
    timezone: 'UTC',
    role: 'member',
    isActive: true,
    preferences: {},
    enabledModules: ['food'],
    createdAt: now,
    updatedAt: now,
  });

  const services = buildFoodServices({ db });
  return {
    services,
    userId,
    cleanup: async () => {
      client.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

describe('pattern engine', () => {
  let h: H;
  beforeEach(async () => {
    h = await setup();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('emits a protein/energy insight when protein meals correlate with high energy', async () => {
    // 5 protein meals all with energy_after = 5
    for (let i = 0; i < 5; i++) {
      const ev = await h.services.foodEvents.create(h.userId, {
        eventType: 'actual_meal',
        source: 'api',
        mealName: `Protein meal ${i}`,
        items: [{ name: 'Chicken', role: 'protein' }],
      });
      await h.services.foodEvents.logOutcome(h.userId, ev.id, {
        foodEventId: ev.id,
        energyAfter: 5,
      });
    }
    // 4 non-protein meals all with energy_after = 2
    for (let i = 0; i < 4; i++) {
      const ev = await h.services.foodEvents.create(h.userId, {
        eventType: 'actual_meal',
        source: 'api',
        mealName: `Carb meal ${i}`,
        items: [{ name: 'Rice', role: 'carb' }],
      });
      await h.services.foodEvents.logOutcome(h.userId, ev.id, {
        foodEventId: ev.id,
        energyAfter: 2,
      });
    }
    const insights = await h.services.patterns.recentInsights(h.userId, 30);
    const protein = insights.find((i) => i.kind === 'protein_energy_correlation');
    expect(protein).toBeDefined();
    expect(protein!.evidenceCount).toBe(9);
    expect(protein!.confidence).toBeGreaterThan(0.5);
  });

  it('flags unpromoted recipe candidates', async () => {
    for (let i = 0; i < 2; i++) {
      const ev = await h.services.foodEvents.create(h.userId, {
        eventType: 'actual_meal',
        source: 'api',
        mealName: `Hit meal ${i}`,
        items: [{ name: 'Salmon', role: 'protein' }],
      });
      await h.services.foodEvents.logOutcome(h.userId, ev.id, {
        foodEventId: ev.id,
        satisfactionScore: 5,
        recipeCandidate: true,
      });
    }
    const insights = await h.services.patterns.recentInsights(h.userId, 30);
    const candidates = insights.find((i) => i.kind === 'unpromoted_recipe_candidates');
    expect(candidates).toBeDefined();
    expect(candidates!.evidenceCount).toBe(2);
  });

  it('detects variety drop on repeated meals', async () => {
    for (let i = 0; i < 4; i++) {
      await h.services.foodEvents.create(h.userId, {
        eventType: 'actual_meal',
        source: 'api',
        mealName: 'Tuna sandwich',
        items: [{ name: 'Tuna', role: 'protein' }],
      });
    }
    for (let i = 0; i < 2; i++) {
      await h.services.foodEvents.create(h.userId, {
        eventType: 'actual_meal',
        source: 'api',
        mealName: `Other ${i}`,
        items: [{ name: 'Eggs', role: 'protein' }],
      });
    }
    const insights = await h.services.patterns.recentInsights(h.userId, 30);
    const variety = insights.find((i) => i.kind === 'variety_drop');
    expect(variety).toBeDefined();
    expect(variety!.headline.toLowerCase()).toContain('tuna sandwich');
  });

  it('weeklyReview composes summary, highlights, and insights', async () => {
    await h.services.foodEvents.create(h.userId, {
      eventType: 'actual_meal',
      source: 'api',
      mealName: 'Salmon plate',
      items: [{ name: 'Salmon', role: 'protein' }],
    });
    const review = await h.services.patterns.weeklyReview(h.userId);
    expect(review.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(review.weekEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(review.summary).toContain('1 meal');
  });

  it('returns no insights on an empty history', async () => {
    const insights = await h.services.patterns.recentInsights(h.userId, 30);
    expect(insights).toEqual([]);
  });
});
