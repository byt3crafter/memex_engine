import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { foodEvent } from './food-event';
import { userProfile } from './profile';

export const recommendation = sqliteTable(
  'recommendation',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    foodEventId: text('food_event_id').references(() => foodEvent.id, {
      onDelete: 'set null',
    }),
    requestedAt: text('requested_at').notNull(),
    cravingText: text('craving_text'),
    goalContext: text('goal_context', { mode: 'json' }).$type<Record<string, unknown>>(),
    availableFoodSnapshot: text('available_food_snapshot', { mode: 'json' })
      .$type<unknown[]>()
      .notNull(),
    engineVersion: text('engine_version').notNull(),
    recommendedTitle: text('recommended_title').notNull(),
    recommendationReason: text('recommendation_reason').notNull(),
    options: text('options', { mode: 'json' }).$type<unknown[]>().notNull(),
    selectedOption: text('selected_option', { mode: 'json' }).$type<unknown>(),
    card: text('card', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userRequestedIdx: index('recommendation_user_requested_idx').on(
      table.userId,
      table.requestedAt,
    ),
  }),
);

export type RecommendationRow = typeof recommendation.$inferSelect;
export type NewRecommendationRow = typeof recommendation.$inferInsert;
