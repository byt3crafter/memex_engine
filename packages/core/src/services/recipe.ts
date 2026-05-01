import type { Db } from '@pantrymind/db';

/** Phase 2 fills: promote food_event → recipe, recipe CRUD, tag search. */
export interface RecipeService {
  readonly _db: Db;
}

export function createRecipeService(db: Db): RecipeService {
  return { _db: db };
}
