import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    displayName: text('display_name').notNull(),
    timezone: text('timezone').notNull(),
    role: text('role').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    preferences: text('preferences', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    enabledModules: text('enabled_modules', { mode: 'json' }).$type<string[]>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    emailIdx: index('user_email_idx').on(table.email),
    roleIdx: index('user_role_idx').on(table.role),
  }),
);

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
