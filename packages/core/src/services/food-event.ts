import type { Db } from '@pantrymind/db';

/** Phase 2 fills: append events / items, log outcomes, list with filters. */
export interface FoodEventService {
  readonly _db: Db;
}

export function createFoodEventService(db: Db): FoodEventService {
  return { _db: db };
}
