import type { Db } from '@pantrymind/db';

/**
 * Pattern engine — the differentiator. Phase 4 fills: protein
 * consistency, energy_after correlations, recipe-candidate detection,
 * weekly review production.
 */
export interface PatternService {
  readonly _db: Db;
}

export function createPatternService(db: Db): PatternService {
  return { _db: db };
}
