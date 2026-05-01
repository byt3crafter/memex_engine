import type { Db } from '@pantrymind/db';

/**
 * Phase 2 fills the deterministic engine v1 (pantry filter + protein
 * scoring + outcome history). Phase 4 swaps in v2 with semantic recall
 * via sqlite-vec while keeping the same public surface.
 */
export const RECOMMENDATION_ENGINE_VERSION_V1 = 'reco@v1' as const;

export interface RecommendationService {
  readonly _db: Db;
  readonly engineVersion: string;
}

export function createRecommendationService(db: Db): RecommendationService {
  return { _db: db, engineVersion: RECOMMENDATION_ENGINE_VERSION_V1 };
}
