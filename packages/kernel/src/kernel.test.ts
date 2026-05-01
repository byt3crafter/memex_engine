import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '@memex/db';
import { CARD_SCHEMA_VERSION, baseCardSchema } from '@memex/schemas';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from './config';
import { createKernel, type Kernel } from './kernel';
import { defineModule, type Module } from './module';

const TEST_BOOTSTRAP = 'test-bootstrap-token-32-chars-minimum-x';

interface TempEnv {
  cleanup: () => Promise<void>;
  kernel: Kernel;
}

// Accepts modules with any service shape — buildServices generic
// resolves invariantly, so the cast is the cleanest path through
// exactOptionalPropertyTypes' strict variance check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bootKernel(modules: readonly Module<any>[]): Promise<TempEnv> {
  const tempDir = await mkdtemp(join(tmpdir(), 'memex-kernel-test-'));
  const dbPath = join(tempDir, 'test.db');
  const config = loadConfig(
    { MEMEX_BOOTSTRAP_TOKEN: TEST_BOOTSTRAP },
    { databaseUrl: `file:${dbPath}`, bootstrapToken: TEST_BOOTSTRAP },
  );
  const { db, client } = createDb({ url: `file:${dbPath}` });
  const logger = pino({ level: 'silent' });
  const kernel = await createKernel({ config, db, logger, modules });
  return {
    kernel,
    cleanup: async () => {
      client.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

describe('createKernel', () => {
  let env: TempEnv | null = null;

  beforeEach(() => {
    env = null;
  });
  afterEach(async () => {
    await env?.cleanup();
  });

  it('boots with no modules and exposes empty registries', async () => {
    env = await bootKernel([]);
    expect(env.kernel.modules.ids()).toEqual([]);
    expect(env.kernel.cards.list()).toEqual([]);
  });

  it('registers a module and applies its services', async () => {
    interface FakeFoodServices {
      ping(): string;
    }
    const foodModule = defineModule<FakeFoodServices>({
      manifest: {
        id: 'food',
        codename: 'Demeter',
        version: '0.1.0',
        description: 'Test food module',
        domain: 'food',
        dependsOn: [],
        scopes: [],
      },
      cards: [
        {
          type: 'food.fake',
          module: 'food',
          schema: baseCardSchema.extend({
            cardSchemaVersion: z.literal(CARD_SCHEMA_VERSION),
            type: z.literal('food.fake'),
            module: z.literal('food'),
          }),
        },
      ],
      buildServices: () => ({ ping: () => 'pong' }),
    });
    env = await bootKernel([foodModule]);
    expect(env.kernel.modules.ids()).toEqual(['food']);
    const food = env.kernel.modules.require<FakeFoodServices>('food');
    expect(food.services.ping()).toBe('pong');
    expect(env.kernel.cards.has('food.fake')).toBe(true);
  });

  it('a module can read a previously-registered module via the kernel handle', async () => {
    const foodModule = defineModule<{ recentMeals: () => string[] }>({
      manifest: {
        id: 'food',
        codename: 'Demeter',
        version: '0.1.0',
        description: 'food',
        domain: 'food',
        dependsOn: [],
        scopes: [],
      },
      buildServices: () => ({ recentMeals: () => ['eggs', 'toast'] }),
    });
    const behaviorModule = defineModule<{ describeYesterday: () => string }>({
      manifest: {
        id: 'behavior',
        codename: 'Sophrosyne',
        version: '0.1.0',
        description: 'behavior',
        domain: 'behavior',
        dependsOn: ['food'],
        scopes: [],
      },
      buildServices: (ctx) => {
        const food = ctx.kernel.getModuleServices<{ recentMeals: () => string[] }>('food');
        return {
          describeYesterday: () => `you ate ${food.recentMeals().join(' and ')}`,
        };
      },
    });
    env = await bootKernel([foodModule, behaviorModule]);
    const behavior = env.kernel.modules.require<{ describeYesterday: () => string }>('behavior');
    expect(behavior.services.describeYesterday()).toBe('you ate eggs and toast');
  });

  it('rejects a module whose dependsOn is missing', async () => {
    const orphan = defineModule<unknown>({
      manifest: {
        id: 'behavior',
        codename: 'Sophrosyne',
        version: '0.1.0',
        description: 'b',
        domain: 'behavior',
        dependsOn: ['food'],
        scopes: [],
      },
      buildServices: () => ({}),
    });
    await expect(bootKernel([orphan])).rejects.toThrow(/depends on unloaded module food/);
  });

  it('rejects duplicate card type registration', async () => {
    const conflictA = defineModule<unknown>({
      manifest: {
        id: 'a',
        codename: 'A',
        version: '0.1.0',
        description: 'a',
        domain: 'a',
        dependsOn: [],
        scopes: [],
      },
      cards: [
        {
          type: 'shared',
          module: 'a',
          schema: baseCardSchema,
        },
      ],
      buildServices: () => ({}),
    });
    const conflictB = defineModule<unknown>({
      manifest: {
        id: 'b',
        codename: 'B',
        version: '0.1.0',
        description: 'b',
        domain: 'b',
        dependsOn: [],
        scopes: [],
      },
      cards: [
        {
          type: 'shared',
          module: 'b',
          schema: baseCardSchema,
        },
      ],
      buildServices: () => ({}),
    });
    await expect(bootKernel([conflictA, conflictB])).rejects.toThrow(
      /card type already registered/,
    );
  });
});
