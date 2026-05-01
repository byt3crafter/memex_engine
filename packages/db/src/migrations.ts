import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client';

/**
 * Folder containing the kernel's own migrations. Modules each ship
 * their own migrations folder; the kernel's createKernel() applies
 * this one first, then iterates registered modules.
 */
export function getKernelMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'drizzle');
}

export async function applyKernelMigrations(db: Db, folder?: string): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: folder ?? getKernelMigrationsFolder() });
}

/**
 * Apply migrations from an arbitrary folder (used by modules to apply
 * their own migration sets after the kernel's).
 */
export async function applyMigrationsFromFolder(db: Db, folder: string): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: folder });
}
