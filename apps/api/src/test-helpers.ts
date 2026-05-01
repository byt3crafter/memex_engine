import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '@memex/db';
import { createKernel, loadConfig, type Kernel } from '@memex/kernel';
import { foodModule } from '@memex/module-food';
import type { Hono } from 'hono';
import { pino } from 'pino';
import { createApp } from './server';

export const TEST_BOOTSTRAP_TOKEN = 'test-bootstrap-token-32-chars-minimum-x';

export interface ApiHarness {
  app: Hono;
  kernel: Kernel;
  baseUrl: string;
  cleanup: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  withBootstrap: (path: string, init?: RequestInit) => Promise<Response>;
  withToken: (token: string, path: string, init?: RequestInit) => Promise<Response>;
}

export async function setupApiHarness(): Promise<ApiHarness> {
  const tempDir = await mkdtemp(join(tmpdir(), 'memex-api-'));
  const dbPath = join(tempDir, 'test.db');
  const config = loadConfig(
    { MEMEX_BOOTSTRAP_TOKEN: TEST_BOOTSTRAP_TOKEN, NODE_ENV: 'test' },
    { databaseUrl: `file:${dbPath}`, bootstrapToken: TEST_BOOTSTRAP_TOKEN },
  );
  const { db, client } = createDb({ url: `file:${dbPath}` });
  const logger = pino({ level: 'silent' });
  const kernel = await createKernel({ config, db, logger, modules: [foodModule] });
  const app = createApp({ kernel, logger });

  const baseRequest = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return await app.request(path, { ...init, headers });
  };

  const withBootstrap = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${TEST_BOOTSTRAP_TOKEN}`);
    return baseRequest(path, { ...init, headers });
  };

  const withToken = (token: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return baseRequest(path, { ...init, headers });
  };

  return {
    app,
    kernel,
    baseUrl: config.baseUrl,
    request: baseRequest,
    withBootstrap,
    withToken,
    cleanup: async () => {
      client.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
