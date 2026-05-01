/**
 * Memex API — thin HTTP adapter over the kernel.
 *
 * Layout:
 *   GET  /health                              public, smoke
 *   POST /admin/bootstrap                     bootstrap-token only
 *   POST /api/v1/connections/pair-complete    public; assistant exchanges
 *                                             a pairing code for a token
 *   /api/v1/* (rest)                          bearer-token gated
 *
 * Modules contribute their own /api/v1/<id>/* routers; mounted by
 * iterating kernel.modules in this createApp.
 */
import type { Kernel } from '@memex/kernel';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { authMiddleware, bootstrapMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { loggerMiddleware } from './middleware/logger';
import { adminRouter } from './routes/admin';
import { connectionsRouter, pairCompleteRouter } from './routes/connections';
import { healthRouter } from './routes/health';
import { meRouter } from './routes/me';

export interface AppDeps {
  kernel: Kernel;
  logger: Logger;
}

export function createApp(deps: AppDeps): Hono {
  const { kernel, logger } = deps;
  const app = new Hono();

  app.use('*', loggerMiddleware(logger));
  app.onError(errorHandler(logger));

  app.route('/health', healthRouter);

  // Admin / bootstrap — gated by MEMEX_BOOTSTRAP_TOKEN.
  const admin = new Hono();
  admin.use('*', bootstrapMiddleware(kernel));
  admin.route('/', adminRouter(kernel));
  app.route('/admin', admin);

  // /api/v1/connections/pair-complete is the one public path inside v1
  // — it accepts the pairing code and returns the token.
  app.route('/api/v1/connections', pairCompleteRouter(kernel));

  // Authed v1 surface.
  const v1 = new Hono();
  v1.use('*', authMiddleware(kernel));
  v1.route('/me', meRouter(kernel));
  v1.route('/connections', connectionsRouter(kernel));

  // Module-contributed routers, each mounted at /api/v1/<routePrefix or id>.
  for (const entry of kernel.modules.list()) {
    const m = entry.module;
    const router = m.buildRoutes?.(entry.services);
    if (!router) continue;
    const prefix = m.manifest.routePrefix ?? m.manifest.id;
    v1.route(`/${prefix}`, router);
  }

  app.route('/api/v1', v1);

  return app;
}
