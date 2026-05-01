import type { Db } from '@pantrymind/db';

/**
 * Profile service. Phase 2 fills the methods (get / update single user
 * profile row). Kept as a typed factory now so apps can wire it in
 * without further refactor.
 */
export interface ProfileService {
  readonly _db: Db;
}

export function createProfileService(db: Db): ProfileService {
  return { _db: db };
}
