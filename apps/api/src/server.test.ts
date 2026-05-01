import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupApiHarness, type ApiHarness, TEST_BOOTSTRAP_TOKEN } from './test-helpers';

describe('memex api', () => {
  let h: ApiHarness;
  beforeEach(async () => {
    h = await setupApiHarness();
  });
  afterEach(async () => {
    await h.cleanup();
  });

  describe('GET /health', () => {
    it('returns ok without auth', async () => {
      const res = await h.request('/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; name: string };
      expect(body.ok).toBe(true);
      expect(body.name).toBe('memex');
    });
  });

  describe('POST /admin/bootstrap', () => {
    it('rejects without bootstrap token', async () => {
      const res = await h.request('/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Dovik', timezone: 'Indian/Mauritius' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects with wrong bootstrap token', async () => {
      const res = await h.request('/admin/bootstrap', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
        body: JSON.stringify({ displayName: 'Dovik', timezone: 'UTC' }),
      });
      expect(res.status).toBe(401);
    });

    it('creates founder + pairing on first call (201), is idempotent on second (200)', async () => {
      const first = await h.withBootstrap('/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Dovik', timezone: 'Indian/Mauritius' }),
      });
      expect(first.status).toBe(201);
      const firstBody = (await first.json()) as {
        founder: { id: string; role: string };
        alreadyExisted: boolean;
        pairing: { pairingCode: string; qrPayload: string };
      };
      expect(firstBody.founder.id).toMatch(/^usr_/);
      expect(firstBody.founder.role).toBe('founder');
      expect(firstBody.alreadyExisted).toBe(false);
      expect(firstBody.pairing.pairingCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(firstBody.pairing.qrPayload).toMatch(/^memex:\/\/pair\?/);

      const second = await h.withBootstrap('/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Different Name', timezone: 'UTC' }),
      });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as {
        founder: { id: string };
        alreadyExisted: boolean;
        pairing: { pairingCode: string };
      };
      expect(secondBody.alreadyExisted).toBe(true);
      expect(secondBody.founder.id).toBe(firstBody.founder.id);
      // a new pairing code is issued each call
      expect(secondBody.pairing.pairingCode).not.toBe(firstBody.pairing.pairingCode);
    });
  });

  describe('end-to-end pairing flow', () => {
    it('bootstrap → pair-complete → use token to call /me', async () => {
      // 1. founder + first pairing code
      const bootstrap = await h.withBootstrap('/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Dovik', timezone: 'Indian/Mauritius' }),
      });
      const bootstrapBody = (await bootstrap.json()) as {
        pairing: { pairingCode: string };
        founder: { id: string };
      };

      // 2. Assistant calls /pair-complete with the code (no auth needed).
      const complete = await h.request('/api/v1/connections/pair-complete', {
        method: 'POST',
        body: JSON.stringify({ code: bootstrapBody.pairing.pairingCode }),
      });
      expect(complete.status).toBe(200);
      const completeBody = (await complete.json()) as {
        token: string;
        userId: string;
        connectionId: string;
      };
      expect(completeBody.token).toMatch(/^mx_/);
      expect(completeBody.userId).toBe(bootstrapBody.founder.id);

      // 3. Use the token to call /me.
      const me = await h.withToken(completeBody.token, '/api/v1/me');
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as {
        user: { id: string; displayName: string };
        connection: { id: string };
      };
      expect(meBody.user.id).toBe(bootstrapBody.founder.id);
      expect(meBody.user.displayName).toBe('Dovik');
      expect(meBody.connection.id).toBe(completeBody.connectionId);

      // 4. /api/v1/connections lists exactly that connection.
      const list = await h.withToken(completeBody.token, '/api/v1/connections');
      expect(list.status).toBe(200);
      const listBody = (await list.json()) as { connections: { id: string }[] };
      expect(listBody.connections).toHaveLength(1);
      expect(listBody.connections[0]!.id).toBe(completeBody.connectionId);

      // 5. Pairing code is single-use.
      const replay = await h.request('/api/v1/connections/pair-complete', {
        method: 'POST',
        body: JSON.stringify({ code: bootstrapBody.pairing.pairingCode }),
      });
      expect(replay.status).toBe(400);
    });

    it('user can pair-start a second assistant after the first', async () => {
      const bootstrap = await h.withBootstrap('/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Dovik', timezone: 'UTC' }),
      });
      const bootstrapBody = (await bootstrap.json()) as { pairing: { pairingCode: string } };
      const first = await h.request('/api/v1/connections/pair-complete', {
        method: 'POST',
        body: JSON.stringify({ code: bootstrapBody.pairing.pairingCode }),
      });
      const firstBody = (await first.json()) as { token: string; userId: string };

      // Use the existing token to start another pairing
      const start = await h.withToken(firstBody.token, '/api/v1/connections/pair-start', {
        method: 'POST',
        body: JSON.stringify({
          clientName: 'Cursor',
          clientKind: 'mcp_stdio',
          scopes: ['food:read'],
        }),
      });
      expect(start.status).toBe(201);
      const startBody = (await start.json()) as {
        pairingCode: string;
        configSnippets: Record<string, string>;
      };
      expect(startBody.pairingCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(startBody.configSnippets['claude_desktop']).toContain('mcpServers');

      const complete = await h.request('/api/v1/connections/pair-complete', {
        method: 'POST',
        body: JSON.stringify({ code: startBody.pairingCode }),
      });
      const completeBody = (await complete.json()) as { userId: string };
      expect(completeBody.userId).toBe(firstBody.userId);

      const list = await h.withToken(firstBody.token, '/api/v1/connections');
      const listBody = (await list.json()) as { connections: unknown[] };
      expect(listBody.connections).toHaveLength(2);
    });

    it('revoking a token blocks future requests with it', async () => {
      const bootstrap = await h.withBootstrap('/admin/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'X', timezone: 'UTC' }),
      });
      const bootstrapBody = (await bootstrap.json()) as { pairing: { pairingCode: string } };
      const complete = await h.request('/api/v1/connections/pair-complete', {
        method: 'POST',
        body: JSON.stringify({ code: bootstrapBody.pairing.pairingCode }),
      });
      const completeBody = (await complete.json()) as { token: string; connectionId: string };

      // Revoke ourselves.
      const del = await h.withToken(
        completeBody.token,
        `/api/v1/connections/${completeBody.connectionId}`,
        { method: 'DELETE' },
      );
      expect(del.status).toBe(200);

      // Subsequent /me must fail.
      const me = await h.withToken(completeBody.token, '/api/v1/me');
      expect(me.status).toBe(401);
    });
  });

  describe('auth boundary', () => {
    it('GET /api/v1/me without token → 401', async () => {
      const res = await h.request('/api/v1/me');
      expect(res.status).toBe(401);
    });

    it('bootstrap token does NOT work as a regular bearer', async () => {
      const res = await h.withToken(TEST_BOOTSTRAP_TOKEN, '/api/v1/me');
      expect(res.status).toBe(401);
    });
  });
});
