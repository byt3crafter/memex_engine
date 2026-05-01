import { loadConfig, createServices } from '@pantrymind/core';
import { createDb } from '@pantrymind/db';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from './server';

const TEST_TOKEN = 'this-is-a-long-enough-token-x';

function buildApp() {
  const config = loadConfig(
    { HEALTHLOOP_API_TOKEN: TEST_TOKEN, NODE_ENV: 'test' },
    { databaseUrl: ':memory:' },
  );
  const { db } = createDb({ url: 'file::memory:' });
  const services = createServices(db);
  const logger = pino({ level: 'silent' });
  return createApp({ config, db, services, logger });
}

describe('api smoke', () => {
  it('GET /health returns 200 with ok payload', async () => {
    const app = buildApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ts: string };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('string');
  });

  it('GET /api/v1/version without bearer returns 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/version');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/version with wrong bearer returns 401', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/version', {
      headers: { Authorization: 'Bearer not-the-right-one' },
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/version with valid bearer returns version info', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/version', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; version: string; api: string };
    expect(body.name).toBe('pantrymind');
    expect(body.api).toBe('v1');
    expect(typeof body.version).toBe('string');
  });

  it('unknown route returns 404', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/does-not-exist', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});
