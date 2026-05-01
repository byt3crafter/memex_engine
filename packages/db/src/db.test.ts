import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyKernelMigrations, createDb, type Db } from './index';
import { KernelIdPrefix, newId, newPairingCode } from './ids';
import * as schema from './schema/index';

describe('@memex/db kernel round-trip', () => {
  let tempDir: string;
  let db: Db;
  let cleanup: () => void;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memex-db-test-'));
    const created = createDb({ url: `file:${join(tempDir, 'test.db')}` });
    db = created.db;
    cleanup = () => created.client.close();
    await applyKernelMigrations(db);
  });

  afterAll(async () => {
    cleanup?.();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('inserts a user, a connection for that user, and a pairing_code', async () => {
    const userId = newId(KernelIdPrefix.user);
    const now = new Date().toISOString();
    await db.insert(schema.user).values({
      id: userId,
      email: 'dovik@example.com',
      displayName: 'Dovik',
      timezone: 'Indian/Mauritius',
      role: 'founder',
      isActive: true,
      preferences: { unitSystem: 'metric' },
      enabledModules: ['food'],
      createdAt: now,
      updatedAt: now,
    });

    const connId = newId(KernelIdPrefix.connection);
    await db.insert(schema.connection).values({
      id: connId,
      userId,
      name: 'Claude Desktop on MacBook',
      kind: 'mcp_stdio',
      tokenHash: 'abc123hash',
      tokenPrefix: 'mx_abc1',
      scopes: ['food:read', 'food:write'],
      metadata: {},
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const code = newPairingCode();
    await db.insert(schema.pairingCode).values({
      code,
      userId,
      clientName: 'Cursor',
      clientKind: 'mcp_stdio',
      scopes: [],
      metadata: {},
      createdAt: now,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      consumedAt: null,
      consumedConnectionId: null,
    });

    const users = await db.select().from(schema.user).all();
    const conns = await db.select().from(schema.connection).all();
    const codes = await db.select().from(schema.pairingCode).all();
    expect(users).toHaveLength(1);
    expect(users[0]!.role).toBe('founder');
    expect(users[0]!.enabledModules).toEqual(['food']);
    expect(conns[0]!.scopes).toEqual(['food:read', 'food:write']);
    expect(codes[0]!.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('newId rejects bad prefixes', () => {
    expect(() => newId('FOO')).toThrow();
    expect(() => newId('a')).toThrow();
    expect(newId('usr')).toMatch(/^usr_/);
  });

  it('newPairingCode produces 8 chars + dash, uppercase, no confusables', () => {
    const code = newPairingCode();
    expect(code).toMatch(
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/,
    );
    expect(code).not.toMatch(/[OIL10]/);
  });
});
