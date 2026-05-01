import type { Db } from '@pantrymind/db';
import type { Clock } from '../util/time';
import { createExportService, type ExportService } from './export';
import { createFoodEventService, type FoodEventService } from './food-event';
import { createMenuService, type MenuService } from './menu';
import { createPantryService, type PantryService } from './pantry';
import { createPatternService, type PatternService } from './pattern';
import { createProfileService, type ProfileService } from './profile';
import { createRecommendationService, type RecommendationService } from './recommendation/index';
import { createRecipeService, type RecipeService } from './recipe';

export * from './export';
export * from './food-event';
export * from './menu';
export * from './pantry';
export * from './pattern';
export * from './profile';
export * from './recipe';
export * from './recommendation/index';

export interface Services {
  profile: ProfileService;
  pantry: PantryService;
  foodEvent: FoodEventService;
  recommendation: RecommendationService;
  recipe: RecipeService;
  menu: MenuService;
  pattern: PatternService;
  export: ExportService;
}

export interface CreateServicesOptions {
  clock?: Clock;
  defaultTimezone?: string;
}

export function createServices(db: Db, options: CreateServicesOptions = {}): Services {
  const clock = options.clock;
  const profile = createProfileService({
    db,
    ...(clock !== undefined ? { clock } : {}),
    ...(options.defaultTimezone !== undefined ? { defaultTimezone: options.defaultTimezone } : {}),
  });
  const pantry = createPantryService({
    db,
    profile,
    ...(clock !== undefined ? { clock } : {}),
  });
  const foodEvent = createFoodEventService({
    db,
    profile,
    ...(clock !== undefined ? { clock } : {}),
  });
  const recipe = createRecipeService({
    db,
    profile,
    foodEvent,
    ...(clock !== undefined ? { clock } : {}),
  });
  const recommendation = createRecommendationService({
    db,
    profile,
    pantry,
    recipe,
    foodEvent,
    ...(clock !== undefined ? { clock } : {}),
  });
  const menu = createMenuService({
    db,
    profile,
    pantry,
    recipe,
    ...(clock !== undefined ? { clock } : {}),
  });
  const exportSvc = createExportService({
    db,
    profile,
    pantry,
    foodEvent,
    recipe,
    menu,
    ...(clock !== undefined ? { clock } : {}),
  });
  return {
    profile,
    pantry,
    foodEvent,
    recipe,
    recommendation,
    menu,
    pattern: createPatternService(db),
    export: exportSvc,
  };
}
