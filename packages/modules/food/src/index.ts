/**
 * Demeter — Memex food module. Exports a defineModule()-compatible
 * Module that the kernel composes alongside others.
 *
 *   import { foodModule } from '@memex/module-food';
 *   await createKernel({ ..., modules: [foodModule] });
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModule, type Module } from '@memex/kernel';
import { foodCardContributions } from './cards/index';
import { buildFoodMcpTools } from './mcp/tools';
import { foodRoutes } from './routes/index';
import { buildFoodServices, type FoodServices } from './services/index';

export * from './schemas/index';
export * from './services/index';
export { foodCardContributions } from './cards/index';

function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src layout: this file → packages/modules/food/src/index.ts
  // Migrations live at packages/modules/food/drizzle/.
  return join(here, '..', 'drizzle');
}

export const foodModule: Module<FoodServices> = defineModule<FoodServices>({
  manifest: {
    id: 'food',
    codename: 'Demeter',
    version: '0.2.0',
    description:
      'Pantry, meals, recipes, menus, and the outcome-aware recommendation engine. The first Memex module.',
    domain: 'food',
    category: 'Food & nutrition',
    icon: '🌾',
    tagline: 'Reality-first food memory. What you have, what you ate, what worked.',
    features: [
      'Pantry-aware meal recommendations',
      'Recipe promotion from real meals you liked',
      'Outcome → pattern engine: protein↔energy correlation, recipe candidates, variety drops',
      'Pantry-overlap menu planner with shopping gaps',
      'Replayable recommendation traces (engine-versioned)',
    ],
    routePrefix: 'food',
    dependsOn: [],
    scopes: ['food:read', 'food:write'],
  },
  migrationsFolder: migrationsFolder(),
  cards: foodCardContributions,
  buildServices: (ctx) =>
    buildFoodServices({
      db: ctx.db,
      ...(ctx.client !== undefined ? { client: ctx.client } : {}),
    }),
  buildRoutes: (services) => foodRoutes(services),
  buildMcpTools: (services) => buildFoodMcpTools(services),
  buildExportData: async (services, userId) => ({
    pantry: await services.pantry.list(userId),
    foodEvents: await services.foodEvents.list(userId, { limit: 10_000 }),
    recipes: await services.recipes.list(userId, { includeInactive: true }),
    menus: await services.menus.list(userId),
  }),
});
