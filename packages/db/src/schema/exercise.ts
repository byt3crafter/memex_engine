import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { userProfile } from './profile';

export const exerciseEvent = sqliteTable(
  'exercise_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    occurredAt: text('occurred_at').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    durationMinutes: integer('duration_minutes'),
    details: text('details', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    difficulty: integer('difficulty'),
    painFlag: integer('pain_flag', { mode: 'boolean' }).notNull().default(false),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userOccurredIdx: index('exercise_event_user_occurred_idx').on(table.userId, table.occurredAt),
  }),
);

export type ExerciseEventRow = typeof exerciseEvent.$inferSelect;
export type NewExerciseEventRow = typeof exerciseEvent.$inferInsert;
