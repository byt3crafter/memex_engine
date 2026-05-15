import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createDb } from '@memex/db';
import { createKernel, loadConfig, type Module } from '@memex/kernel';
import { foodModule } from '@memex/module-food';
import { defineTelegramModule } from '@memex/module-telegram';
import { pino } from 'pino';
import { createApp } from './server';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

if (config.databaseUrl.startsWith('file:')) {
  await mkdir(dirname(config.databaseUrl.slice('file:'.length)), { recursive: true });
}

const { db, client } = createDb({
  url: config.databaseUrl,
  ...(config.databaseAuthToken !== undefined ? { authToken: config.databaseAuthToken } : {}),
});

// Compose the module list. Iris (Telegram) is enabled only when both
// MEMEX_TELEGRAM_BOT_TOKEN + MEMEX_TELEGRAM_WEBHOOK_SECRET are set —
// kernel boots cleanly without it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modules: Module<any>[] = [foodModule];
if (config.telegramBotToken && config.telegramWebhookSecret) {
  modules.push(
    defineTelegramModule({
      botToken: config.telegramBotToken,
      webhookSecret: config.telegramWebhookSecret,
    }),
  );
  logger.info('memex.api.iris_enabled');
} else {
  logger.warn(
    'memex.api.iris_disabled — set MEMEX_TELEGRAM_BOT_TOKEN + MEMEX_TELEGRAM_WEBHOOK_SECRET to enable',
  );
}

const kernel = await createKernel({
  config,
  db,
  client,
  logger,
  modules,
});

const app = createApp({ kernel, logger });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, baseUrl: config.baseUrl, modules: kernel.modules.ids() },
    'memex.api.listening',
  );
});
