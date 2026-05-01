import type { AppConfig, Services } from '@pantrymind/core';
import type { Db } from '@pantrymind/db';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { loggerMiddleware } from './middleware/logger';
import { healthRouter } from './routes/health';
import { profileRouter } from './routes/profile';
import { versionRouter } from './routes/version';

export interface AppDeps {
  config: AppConfig;
  db: Db;
  services: Services;
  logger: Logger;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('*', loggerMiddleware(deps.logger));
  app.onError(errorHandler(deps.logger));

  app.route('/health', healthRouter);

  const v1 = new Hono();
  v1.use('*', authMiddleware(deps.config.apiToken));
  v1.route('/version', versionRouter);
  v1.route('/profile', profileRouter(deps.services));
  app.route('/api/v1', v1);

  return app;
}
