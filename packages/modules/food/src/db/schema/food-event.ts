import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as kernel from '@memex/db/schema';

export const foodEvent = sqliteTable(
  'food_event',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => kernel.user.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    source: text('source').notNull(),
    rawText: text('raw_text'),
    imageRefs: text('image_refs', { mode: 'json' }).$type<unknown[]>(),
    cravingText: text('craving_text'),
    availableFoodContext: text('available_food_context', { mode: 'json' }).$type<unknown[]>(),
    mealName: text('meal_name'),
    actualEaten: integer('actual_eaten', { mode: 'boolean' }),
    eatenByUser: integer('eaten_by_user', { mode: 'boolean' }),
    forPerson: text('for_person'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userOccurredIdx: index('food_event_user_occurred_idx').on(table.userId, table.occurredAt),
    typeIdx: index('food_event_type_idx').on(table.userId, table.eventType),
  }),
);
export type FoodEventRow = typeof foodEvent.$inferSelect;
export type NewFoodEventRow = typeof foodEvent.$inferInsert;

export const foodEventItem = sqliteTable(
  'food_event_item',
  {
    id: text('id').primaryKey(),
    foodEventId: text('food_event_id')
      .notNull()
      .references(() => foodEvent.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    role: text('role').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    caloriesEstimated: real('calories_estimated'),
    proteinGEstimated: real('protein_g_estimated'),
    carbsGEstimated: real('carbs_g_estimated'),
    fatGEstimated: real('fat_g_estimated'),
    estimateConfidence: real('estimate_confidence'),
    estimateSource: text('estimate_source'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    eventIdx: index('food_event_item_event_idx').on(table.foodEventId),
    nameIdx: index('food_event_item_name_idx').on(table.normalizedName),
  }),
);
export type FoodEventItemRow = typeof foodEventItem.$inferSelect;
export type NewFoodEventItemRow = typeof foodEventItem.$inferInsert;
