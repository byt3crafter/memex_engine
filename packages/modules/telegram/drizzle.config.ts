import { defineConfig } from 'drizzle-kit';

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
