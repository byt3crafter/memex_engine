import { Hono } from 'hono';

const versionInfo = {
  name: 'pantrymind',
  version: '0.0.0-pre',
  api: 'v1',
} as const;

export const versionRouter = new Hono();

versionRouter.get('/', (c) => c.json(versionInfo));
