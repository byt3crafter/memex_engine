import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness } from '../test-helpers';

describe('GET/PUT /api/v1/profile', () => {
  let h: ApiHarness;

  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  it('GET returns the auto-created profile', async () => {
    const res = await h.request('/api/v1/profile');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; displayName: string; timezone: string };
    expect(body.id).toMatch(/^usr_/);
    expect(body.displayName).toBe('PantryMind User');
    expect(body.timezone).toBe('UTC');
  });

  it('PUT updates and persists', async () => {
    const res = await h.request('/api/v1/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Dovik', timezone: 'Indian/Mauritius' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { displayName: string; timezone: string };
    expect(body.displayName).toBe('Dovik');
    expect(body.timezone).toBe('Indian/Mauritius');

    const fetched = await h.request('/api/v1/profile');
    const fetchedBody = (await fetched.json()) as { displayName: string };
    expect(fetchedBody.displayName).toBe('Dovik');
  });

  it('PUT rejects an empty displayName', async () => {
    const res = await h.request('/api/v1/profile', {
      method: 'PUT',
      body: JSON.stringify({ displayName: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET without bearer is 401', async () => {
    const res = await h.app.request('/api/v1/profile');
    expect(res.status).toBe(401);
  });
});
