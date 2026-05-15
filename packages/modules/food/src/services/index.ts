import type { Client } from '@libsql/client';
import type { Db } from '@memex/db';
import type { Clock } from '@memex/kernel';
import { createEmbeddingService, type EmbeddingService } from './embeddings';
import { createFoodEventService, type FoodEventService } from './food-event';
import { createMenuService, type MenuService } from './menu';
import { createPantryService, type PantryService } from './pantry';
import { createPatternService, type PatternService } from './patterns';
import { createRecipeService, type RecipeService } from './recipe';
import { createRecommendationService, type RecommendationService } from './recommendation/index';

export * from './embeddings';
export * from './errors';
export * from './food-event';
export * from './menu';
export * from './pantry';
export * from './patterns';
export * from './recipe';
export * from './recommendation/index';

export interface FoodServices {
  pantry: PantryService;
  foodEvents: FoodEventService;
  recipes: RecipeService;
  menus: MenuService;
  recommendations: RecommendationService;
  patterns: PatternService;
  embeddings: EmbeddingService | null;
}

export interface BuildFoodServicesDeps {
  db: Db;
  client?: Client;
  clock?: Clock;
}

export function buildFoodServices(deps: BuildFoodServicesDeps): FoodServices {
  const { db, client, clock } = deps;
  const clockOpt = clock !== undefined ? { clock } : {};
  const pantry = createPantryService({ db, ...clockOpt });
  const foodEventsBase = createFoodEventService({ db, ...clockOpt });
  const recipes = createRecipeService({ db, foodEvents: foodEventsBase, ...clockOpt });
  const menus = createMenuService({ db, pantry, recipes, ...clockOpt });
  const embeddings = client ? createEmbeddingService({ db, client }) : null;
  const recommendations = createRecommendationService({
    db,
    pantry,
    recipes,
    foodEvents: foodEventsBase,
    ...(embeddings !== null ? { embeddings } : {}),
    ...clockOpt,
  });
  const patterns = createPatternService({ db, foodEvents: foodEventsBase, recipes, ...clockOpt });

  // Wrap foodEvents to trigger async embedding on actual_meal creates.
  const foodEvents: FoodEventService = {
    ...foodEventsBase,
    async create(userId, input) {
      const event = await foodEventsBase.create(userId, input);
      if (embeddings && event.eventType === 'actual_meal') {
        embeddings.embedAndStoreFoodEvent(event).catch(() => {
          /* non-blocking; errors logged inside */
        });
      }
      return event;
    },
  };

  // Wrap recipes to trigger async embedding on create / promote.
  const recipesWithEmbed: RecipeService = {
    ...recipes,
    async create(userId, input) {
      const recipe = await recipes.create(userId, input);
      if (embeddings) {
        embeddings.embedAndStoreRecipe(recipe).catch(() => {
          /* non-blocking */
        });
      }
      return recipe;
    },
    async promoteFromFoodEvent(userId, foodEventId, overrides) {
      const recipe = await recipes.promoteFromFoodEvent(userId, foodEventId, overrides);
      if (embeddings) {
        embeddings.embedAndStoreRecipe(recipe).catch(() => {
          /* non-blocking */
        });
      }
      return recipe;
    },
  };

  return {
    pantry,
    foodEvents,
    recipes: recipesWithEmbed,
    menus,
    recommendations,
    patterns,
    embeddings,
  };
}
