import type { Db } from '@pantrymind/db';
import { createFoodEventService, type FoodEventService } from './food-event';
import { createMenuService, type MenuService } from './menu';
import { createPantryService, type PantryService } from './pantry';
import { createPatternService, type PatternService } from './pattern';
import { createProfileService, type ProfileService } from './profile';
import {
  createRecommendationService,
  type RecommendationService,
} from './recommendation';
import { createRecipeService, type RecipeService } from './recipe';

export * from './food-event';
export * from './menu';
export * from './pantry';
export * from './pattern';
export * from './profile';
export * from './recipe';
export * from './recommendation';

export interface Services {
  profile: ProfileService;
  pantry: PantryService;
  foodEvent: FoodEventService;
  recommendation: RecommendationService;
  recipe: RecipeService;
  menu: MenuService;
  pattern: PatternService;
}

export function createServices(db: Db): Services {
  return {
    profile: createProfileService(db),
    pantry: createPantryService(db),
    foodEvent: createFoodEventService(db),
    recommendation: createRecommendationService(db),
    recipe: createRecipeService(db),
    menu: createMenuService(db),
    pattern: createPatternService(db),
  };
}
