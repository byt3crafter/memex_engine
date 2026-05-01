import { Hono } from 'hono';

export const healthRouter = new Hono();

healthRouter.get('/', (c) =>
  c.json({ ok: true, name: 'memex', version: '0.0.1-alpha', ts: new Date().toISOString() }),
);
