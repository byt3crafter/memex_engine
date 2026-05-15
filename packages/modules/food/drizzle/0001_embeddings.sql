-- sqlite-vec virtual tables for semantic recall (requires sqlite-vec extension).
-- This file is applied by EmbeddingService.ensureVecTables() at runtime,
-- NOT by drizzle-kit migrate, because the vec0 module may not be present in
-- all environments. The drizzle migration journal is intentionally not updated
-- so drizzle never attempts to run this SQL autonomously.
--
-- Dimension 384 matches Xenova/all-MiniLM-L6-v2.

CREATE VIRTUAL TABLE IF NOT EXISTS recipe_vec (
  recipe_id TEXT PRIMARY KEY,
  embedding FLOAT[384]
) USING vec0;

CREATE VIRTUAL TABLE IF NOT EXISTS food_event_vec (
  food_event_id TEXT PRIMARY KEY,
  embedding FLOAT[384]
) USING vec0;
