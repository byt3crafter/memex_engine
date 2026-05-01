import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { userProfile } from './profile';

export const pantryItem = sqliteTable(
  'pantry_item',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    category: text('category').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    expiryDate: text('expiry_date'),
    source: text('source').notNull(),
    confidence: real('confidence'),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userIdx: index('pantry_item_user_idx').on(table.userId),
    normalizedIdx: index('pantry_item_normalized_idx').on(table.userId, table.normalizedName),
    categoryIdx: index('pantry_item_category_idx').on(table.userId, table.category),
    availableIdx: index('pantry_item_available_idx').on(table.userId, table.isAvailable),
  }),
);

export type PantryItemRow = typeof pantryItem.$inferSelect;
export type NewPantryItemRow = typeof pantryItem.$inferInsert;
