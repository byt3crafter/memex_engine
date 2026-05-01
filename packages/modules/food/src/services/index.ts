import type { Db } from '@memex/db';
import type { Clock } from '@memex/kernel';
import { createFoodEventService, type FoodEventService } from './food-event';
import { createMenuService, type MenuService } from './menu';
import { createPantryService, type PantryService } from './pantry';
import { createPatternService, type PatternService } from './patterns';
import { createRecipeService, type RecipeService } from './recipe';
import { createRecommendationService, type RecommendationService } from './recommendation/index';

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
}

export interface BuildFoodServicesDeps {
  db: Db;
  clock?: Clock;
}

export function buildFoodServices(deps: BuildFoodServicesDeps): FoodServices {
  const { db, clock } = deps;
  const clockOpt = clock !== undefined ? { clock } : {};
  const pantry = createPantryService({ db, ...clockOpt });
  const foodEvents = createFoodEventService({ db, ...clockOpt });
  const recipes = createRecipeService({ db, foodEvents, ...clockOpt });
  const menus = createMenuService({ db, pantry, recipes, ...clockOpt });
  const recommendations = createRecommendationService({
    db,
    pantry,
    recipes,
    foodEvents,
    ...clockOpt,
  });
  const patterns = createPatternService({ db, foodEvents, recipes, ...clockOpt });
  return { pantry, foodEvents, recipes, menus, recommendations, patterns };
}
