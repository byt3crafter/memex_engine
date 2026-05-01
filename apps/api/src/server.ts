import type { AppConfig, Services } from '@pantrymind/core';
import type { Db } from '@pantrymind/db';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { loggerMiddleware } from './middleware/logger';
import { exportRouter } from './routes/export';
import { foodEventsRouter } from './routes/food-events';
import { healthRouter } from './routes/health';
import { menusRouter } from './routes/menus';
import { pantryRouter } from './routes/pantry';
import { profileRouter } from './routes/profile';
import { recipesRouter } from './routes/recipes';
import { recommendationsRouter } from './routes/recommendations';
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
  v1.route('/pantry', pantryRouter(deps.services));
  v1.route('/food-events', foodEventsRouter(deps.services));
  v1.route('/recipes', recipesRouter(deps.services));
  v1.route('/recommendations', recommendationsRouter(deps.services));
  v1.route('/menus', menusRouter(deps.services));
  v1.route('/export', exportRouter(deps.services));
  app.route('/api/v1', v1);

  return app;
}
