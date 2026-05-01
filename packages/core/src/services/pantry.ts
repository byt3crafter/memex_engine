import type { Db } from '@pantrymind/db';

/** Phase 2 fills: list / create / update / delete / bulk-update / availability. */
export interface PantryService {
  readonly _db: Db;
}

export function createPantryService(db: Db): PantryService {
  return { _db: db };
}
