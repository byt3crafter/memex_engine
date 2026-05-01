import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { userProfile } from './profile';

export const measurement = sqliteTable(
  'measurement',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    value: text('value').notNull(),
    unit: text('unit').notNull(),
    measuredAt: text('measured_at').notNull(),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userMeasuredIdx: index('measurement_user_measured_idx').on(table.userId, table.measuredAt),
  }),
);

export type MeasurementRow = typeof measurement.$inferSelect;
export type NewMeasurementRow = typeof measurement.$inferInsert;
