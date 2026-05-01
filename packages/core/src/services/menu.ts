import type { Db } from '@pantrymind/db';

/** Phase 2 fills: pantry → menu suggestion + shopping gap diff. */
export interface MenuService {
  readonly _db: Db;
}

export function createMenuService(db: Db): MenuService {
  return { _db: db };
}
