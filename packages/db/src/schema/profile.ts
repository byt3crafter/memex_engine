import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const userProfile = sqliteTable('user_profile', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  timezone: text('timezone').notNull(),
  goals: text('goals', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  dietaryPreferences: text('dietary_preferences', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull(),
  allergies: text('allergies', { mode: 'json' }).$type<string[]>().notNull(),
  healthNotes: text('health_notes', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export type UserProfileRow = typeof userProfile.$inferSelect;
export type NewUserProfileRow = typeof userProfile.$inferInsert;
