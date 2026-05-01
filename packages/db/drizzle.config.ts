import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env['HEALTHLOOP_DATABASE_URL'] ?? 'file:./data/pantrymind.db',
  },
  verbose: true,
  strict: true,
});
