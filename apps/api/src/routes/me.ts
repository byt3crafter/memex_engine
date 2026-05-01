import type { Kernel } from '@memex/kernel';
import { Hono } from 'hono';

export function meRouter(kernel: Kernel): Hono {
  const r = new Hono();

  r.get('/', async (c) => {
    const user = c.get('user');
    const connection = c.get('connection');
    return c.json({
      user,
      connection,
      modules: kernel.modules.ids(),
    });
  });

  return r;
}
