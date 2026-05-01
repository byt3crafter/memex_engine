import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client';

/**
 * Resolve the migrations folder shipped with this package. Works in
 * both source (tsx, vitest) and compiled (dist/migrations.js) layouts
 * because the folder always sits one level above the importing module.
 */
export function getMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'drizzle');
}

export async function applyMigrations(db: Db, folder?: string): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: folder ?? getMigrationsFolder() });
}
