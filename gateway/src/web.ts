import type { Hono } from 'hono';

export function mountWebApp(app: Hono<any>): void {
  app.get('/', (c) => c.redirect('/app'));
}
