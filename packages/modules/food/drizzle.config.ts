import { defineConfig } from 'drizzle-kit';

/**
 * Demeter (food) module — owns its own SQL migrations. drizzle-kit
 * targets only this module's schema files; the kernel's tables live in
 * a separate folder under packages/db/. The kernel composes both at
 * boot via applyMigrationsFromFolder.
 */
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env['MEMEX_DATABASE_URL'] ?? 'file:./data/memex.db',
  },
  verbose: true,
  strict: true,
});
