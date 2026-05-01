import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { connection } from './connection';
import { user } from './user';

export const pairingCode = sqliteTable(
  'pairing_code',
  {
    code: text('code').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientName: text('client_name').notNull(),
    clientKind: text('client_kind').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    consumedConnectionId: text('consumed_connection_id').references(() => connection.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    userIdx: index('pairing_code_user_idx').on(table.userId),
    expiresIdx: index('pairing_code_expires_idx').on(table.expiresAt),
  }),
);

export type PairingCodeRow = typeof pairingCode.$inferSelect;
export type NewPairingCodeRow = typeof pairingCode.$inferInsert;
