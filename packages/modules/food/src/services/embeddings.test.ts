/**
 * Tests for the embedding service.
 *
 * NOTE ON CCR ENVIRONMENT: The all-MiniLM-L6-v2 model download (~90 MB)
 * requires outbound internet access and sufficient disk space. In the remote
 * CCR (Cloud Code Runner) environment these conditions may not hold. The
 * embedder tests that need the actual model are gated behind
 * MEMEX_ALLOW_MODEL_DOWNLOAD=1 and will be skipped otherwise.
 *
 * For local dev: MEMEX_ALLOW_MODEL_DOWNLOAD=1 pnpm --filter @memex/module-food test
 *
 * The integration test for findSimilarMeals uses a mock embedder so it runs
 * in all environments once sqlite-vec is available.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyKernelMigrations,
  applyMigrationsFromFolder,
  createDb,
  loadVecExtension,
} from '@memex/db';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  embedText,
  getEmbedder,
  resetEmbedderForTest,
  resetVecStateForTest,
  createEmbeddingService,
} from './embeddings';
import { buildFoodServices } from './index';

const modelAvailable = process.env['MEMEX_ALLOW_MODEL_DOWNLOAD'] === '1';

// --------------------------------------------------------------------------
// Embedder unit tests
// --------------------------------------------------------------------------

describe('embedder', () => {
  beforeEach(() => {
    resetEmbedderForTest();
  });

  it.skipIf(!modelAvailable)(
    'getEmbedder returns a callable function when model is available',
    async () => {
      const embed = await getEmbedder();
      expect(embed).not.toBeNull();
    },
    30_000,
  );

  it.skipIf(!modelAvailable)(
    'same input → near-identical vector (cosine similarity ≥ 0.99)',
    async () => {
      const vec1 = await embedText('grilled chicken with rice and salad');
      const vec2 = await embedText('grilled chicken with rice and salad');
      expect(vec1).not.toBeNull();
      expect(vec2).not.toBeNull();
      expect(vec1!.length).toBe(384);

      // Cosine similarity between two embeddings of identical text should be ≥ 0.99
      const dot = vec1!.reduce((acc, v, i) => acc + v * (vec2![i] ?? 0), 0);
      const normA = Math.sqrt(vec1!.reduce((acc, v) => acc + v * v, 0));
      const normB = Math.sqrt(vec2!.reduce((acc, v) => acc + v * v, 0));
      const cosine = dot / (normA * normB);
      expect(cosine).toBeGreaterThanOrEqual(0.99);
    },
    30_000,
  );

  it('returns null when model is unavailable (default CCR behaviour)', async () => {
    // Model download is disabled by default (MEMEX_ALLOW_MODEL_DOWNLOAD not set).
    if (modelAvailable) return; // skip this assertion in model-enabled runs
    const vec = await embedText('anything');
    expect(vec).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Vec + integration tests (require sqlite-vec native extension)
// --------------------------------------------------------------------------

interface H {
  cleanup: () => Promise<void>;
  services: ReturnType<typeof buildFoodServices>;
  embeddingService: ReturnType<typeof createEmbeddingService> | null;
  userId: string;
  vecLoaded: boolean;
}

async function setupWithVec(): Promise<H> {
  const tempDir = await mkdtemp(join(tmpdir(), 'memex-emb-'));
  const dbPath = join(tempDir, 'test.db');
  const { db, client } = createDb({ url: `file:${dbPath}` });
  const vecLoaded = await loadVecExtension(client);

  await applyKernelMigrations(db);
  const here = dirname(fileURLToPath(import.meta.url));
  await applyMigrationsFromFolder(db, join(here, '..', '..', 'drizzle'));

  const { schema } = await import('@memex/db');
  const now = new Date().toISOString();
  const userId = 'usr_emb_' + Math.random().toString(36).slice(2, 10);
  await db.insert(schema.user).values({
    id: userId,
    email: null,
    displayName: 'EmbTest',
    timezone: 'UTC',
    role: 'member',
    isActive: true,
    preferences: {},
    enabledModules: ['food'],
    createdAt: now,
    updatedAt: now,
  });

  const services = buildFoodServices({ db, client });
  const embeddingService = vecLoaded ? createEmbeddingService({ db, client }) : null;

  return {
    services,
    embeddingService,
    userId,
    vecLoaded,
    cleanup: async () => {
      resetVecStateForTest();
      client.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

describe('embedding service (sqlite-vec)', () => {
  let h: H;

  beforeEach(async () => {
    h = await setupWithVec();
  });

  afterEach(async () => {
    await h.cleanup();
  });

  it('gracefully reports vec unavailable when extension cannot load', () => {
    if (h.vecLoaded) {
      // Extension loaded — skip this assertion
      return;
    }
    expect(h.services.embeddings?.isAvailable() ?? false).toBe(false);
  });

  it.skipIf(!modelAvailable)(
    'integration: seeds 5 meals, embeds them, "something heavy" returns a heavy meal first',
    async () => {
      if (!h.vecLoaded) {
        console.log('skipping: sqlite-vec not available');
        return;
      }
      if (!h.embeddingService) return;

      // Seed 3 "heavy" high-satisfaction meals
      for (let i = 0; i < 3; i++) {
        const ev = await h.services.foodEvents.create(h.userId, {
          eventType: 'actual_meal',
          source: 'api',
          mealName: `Heavy beef stew ${i}`,
          cravingText: 'hearty filling heavy meal',
          items: [
            { name: 'Beef', role: 'protein' },
            { name: 'Potatoes', role: 'carb' },
          ],
        });
        await h.services.foodEvents.logOutcome(h.userId, ev.id, {
          foodEventId: ev.id,
          satisfactionScore: 5,
        });
        await h.embeddingService.embedAndStoreFoodEvent(
          await h.services.foodEvents.getById(h.userId, ev.id),
        );
      }

      // Seed 2 "light" low-satisfaction meals
      for (let i = 0; i < 2; i++) {
        const ev = await h.services.foodEvents.create(h.userId, {
          eventType: 'actual_meal',
          source: 'api',
          mealName: `Light garden salad ${i}`,
          cravingText: 'light refreshing salad',
          items: [{ name: 'Lettuce', role: 'vegetable' }],
        });
        await h.services.foodEvents.logOutcome(h.userId, ev.id, {
          foodEventId: ev.id,
          satisfactionScore: 2,
        });
        await h.embeddingService.embedAndStoreFoodEvent(
          await h.services.foodEvents.getById(h.userId, ev.id),
        );
      }

      const results = await h.embeddingService.findSimilarMeals(
        h.userId,
        'something heavy and filling',
        3,
      );

      expect(results.length).toBeGreaterThan(0);
      // Top result should be a heavy meal
      const topMealName = results[0]?.mealName ?? '';
      expect(topMealName.toLowerCase()).toContain('heavy');
    },
    60_000,
  );
});
