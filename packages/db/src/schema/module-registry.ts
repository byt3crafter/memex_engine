import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Tracks which modules are installed and at what version. The kernel
 * compares manifest.version against this row on boot and decides
 * whether to apply pending module migrations.
 */
export const moduleRegistry = sqliteTable('module_registry', {
  id: text('id').primaryKey(),
  codename: text('codename').notNull(),
  version: text('version').notNull(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  installedAt: text('installed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type ModuleRegistryRow = typeof moduleRegistry.$inferSelect;
export type NewModuleRegistryRow = typeof moduleRegistry.$inferInsert;
