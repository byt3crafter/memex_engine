import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { user } from './user';

export const connection = sqliteTable(
  'connection',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userIdx: index('connection_user_idx').on(table.userId),
    tokenHashIdx: uniqueIndex('connection_token_hash_idx').on(table.tokenHash),
    kindIdx: index('connection_kind_idx').on(table.userId, table.kind),
  }),
);

export type ConnectionRow = typeof connection.$inferSelect;
export type NewConnectionRow = typeof connection.$inferInsert;
