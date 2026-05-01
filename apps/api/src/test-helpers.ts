import { loadConfig, type Services } from '@pantrymind/core';
import { setupTestHarness, type TestHarness } from '@pantrymind/core/test-support';
import type { Hono } from 'hono';
import { pino } from 'pino';
import { createApp } from './server';

export const TEST_TOKEN = 'this-is-a-long-enough-token-x';

export interface ApiHarness {
  app: Hono;
  services: Services;
  cleanup: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function setupApiHarness(): Promise<ApiHarness> {
  const harness: TestHarness = await setupTestHarness();
  const config = loadConfig(
    { HEALTHLOOP_API_TOKEN: TEST_TOKEN, NODE_ENV: 'test' },
    { databaseUrl: harness.dbPath },
  );
  const logger = pino({ level: 'silent' });
  const app = createApp({
    config,
    db: harness.db,
    services: harness.services,
    logger,
  });

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${TEST_TOKEN}`);
    }
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return await app.request(path, { ...init, headers });
  };

  return {
    app,
    services: harness.services,
    cleanup: harness.cleanup,
    request,
  };
}
