import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createDb } from '@memex/db';
import { createKernel, loadConfig } from '@memex/kernel';
import { foodModule } from '@memex/module-food';
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

const { db } = createDb({
  url: config.databaseUrl,
  ...(config.databaseAuthToken !== undefined ? { authToken: config.databaseAuthToken } : {}),
});

const kernel = await createKernel({
  config,
  db,
  logger,
  modules: [foodModule],
});

const app = createApp({ kernel, logger });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info(
    { port: info.port, baseUrl: config.baseUrl, modules: kernel.modules.ids() },
    'memex.api.listening',
  );
});
