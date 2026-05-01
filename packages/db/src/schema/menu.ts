import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { userProfile } from './profile';

export const menuPlan = sqliteTable(
  'menu_plan',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startDate: text('start_date'),
    endDate: text('end_date'),
    generatedFrom: text('generated_from').notNull(),
    items: text('items', { mode: 'json' }).$type<unknown[]>().notNull(),
    shoppingGaps: text('shopping_gaps', { mode: 'json' }).$type<unknown[]>().notNull(),
    card: text('card', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userStartIdx: index('menu_plan_user_start_idx').on(table.userId, table.startDate),
  }),
);

export type MenuPlanRow = typeof menuPlan.$inferSelect;
export type NewMenuPlanRow = typeof menuPlan.$inferInsert;
