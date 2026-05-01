import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { foodEvent } from './food-event';
import { userProfile } from './profile';

export const mealOutcome = sqliteTable(
  'meal_outcome',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    foodEventId: text('food_event_id')
      .notNull()
      .references(() => foodEvent.id, { onDelete: 'cascade' }),
    satisfactionScore: integer('satisfaction_score'),
    hungerAfter: integer('hunger_after'),
    energyAfter: integer('energy_after'),
    cravingsAfter: integer('cravings_after'),
    moodAfter: text('mood_after'),
    notes: text('notes'),
    recipeCandidate: integer('recipe_candidate', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    eventIdx: index('meal_outcome_event_idx').on(table.foodEventId),
    userIdx: index('meal_outcome_user_idx').on(table.userId),
  }),
);

export type MealOutcomeRow = typeof mealOutcome.$inferSelect;
export type NewMealOutcomeRow = typeof mealOutcome.$inferInsert;
