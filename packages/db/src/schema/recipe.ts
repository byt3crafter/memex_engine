import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { foodEvent } from './food-event';
import { userProfile } from './profile';

export const recipe = sqliteTable(
  'recipe',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    sourceFoodEventId: text('source_food_event_id').references(() => foodEvent.id, {
      onDelete: 'set null',
    }),
    ingredients: text('ingredients', { mode: 'json' }).$type<unknown[]>().notNull(),
    steps: text('steps', { mode: 'json' }).$type<unknown[]>().notNull(),
    proteinSource: text('protein_source'),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
    estimatedCalories: real('estimated_calories'),
    estimatedProteinG: real('estimated_protein_g'),
    estimatedCarbsG: real('estimated_carbs_g'),
    estimatedFatG: real('estimated_fat_g'),
    personalRating: integer('personal_rating'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userActiveIdx: index('recipe_user_active_idx').on(table.userId, table.isActive),
    titleIdx: index('recipe_title_idx').on(table.userId, table.title),
  }),
);

export type RecipeRow = typeof recipe.$inferSelect;
export type NewRecipeRow = typeof recipe.$inferInsert;
