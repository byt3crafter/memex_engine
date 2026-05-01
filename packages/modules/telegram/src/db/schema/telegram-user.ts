import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as kernel from '@memex/db/schema';

/**
 * Maps a Telegram user to a Memex user. The Telegram numeric id is the
 * stable identity; username can change at any time.
 */
export const telegramUser = sqliteTable(
  'telegram_user',
  {
    telegramId: integer('telegram_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => kernel.user.id, { onDelete: 'cascade' }),
    username: text('username'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    languageCode: text('language_code'),
    isPremium: integer('is_premium', { mode: 'boolean' }).notNull().default(false),
    notificationsEnabled: integer('notifications_enabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    userIdx: index('telegram_user_user_idx').on(table.userId),
  }),
);

export type TelegramUserRow = typeof telegramUser.$inferSelect;
export type NewTelegramUserRow = typeof telegramUser.$inferInsert;
