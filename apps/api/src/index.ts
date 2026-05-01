import { serve } from '@hono/node-server';
import { loadConfig, createServices } from '@pantrymind/core';
import { createDb } from '@pantrymind/db';
import { pino } from 'pino';
import { createApp } from './server';

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  ...(config.nodeEnv === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

const { db } = createDb({
  url: config.databaseUrl,
  ...(config.databaseAuthToken !== undefined ? { authToken: config.databaseAuthToken } : {}),
});
const services = createServices(db);
const app = createApp({ config, db, services, logger });

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    logger.info(
      { port: info.port, nodeEnv: config.nodeEnv, baseUrl: config.baseUrl },
      'pantrymind api listening',
    );
  },
);
