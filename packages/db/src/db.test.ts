import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client';
import { newId } from './ids';
import * as schema from './schema/index';

describe('db round-trip', () => {
  let tempDir: string;
  let db: Db;
  let cleanup: () => void;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pantrymind-db-test-'));
    const dbPath = join(tempDir, 'test.db');
    const created = createDb({ url: `file:${dbPath}` });
    db = created.db;
    cleanup = () => created.client.close();

    const migrationsFolder = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'drizzle');
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    cleanup?.();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('inserts and reads back a user_profile row', async () => {
    const id = newId('user');
    const now = new Date().toISOString();
    await db.insert(schema.userProfile).values({
      id,
      displayName: 'Test User',
      timezone: 'UTC',
      goals: { protein_g_per_day: 150 },
      dietaryPreferences: {},
      allergies: ['shellfish'],
      healthNotes: {},
      createdAt: now,
      updatedAt: now,
    });

    const rows = await db.select().from(schema.userProfile).all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe(id);
    expect(row.displayName).toBe('Test User');
    expect(row.allergies).toEqual(['shellfish']);
    expect((row.goals as Record<string, unknown>)['protein_g_per_day']).toBe(150);
  });

  it('round-trips a pantry_item linked to the profile', async () => {
    const profile = (await db.select().from(schema.userProfile).all())[0]!;
    const id = newId('pantry');
    const now = new Date().toISOString();
    await db.insert(schema.pantryItem).values({
      id,
      userId: profile.id,
      name: 'Chicken breast',
      normalizedName: 'chicken breast',
      category: 'protein',
      quantity: 500,
      unit: 'g',
      expiryDate: null,
      source: 'manual',
      confidence: null,
      isAvailable: true,
      createdAt: now,
      updatedAt: now,
    });

    const items = await db.select().from(schema.pantryItem).all();
    expect(items).toHaveLength(1);
    expect(items[0]!.isAvailable).toBe(true);
    expect(items[0]!.quantity).toBe(500);
  });

  it('newId produces prefixed ids', () => {
    expect(newId('user')).toMatch(/^usr_/);
    expect(newId('recipe')).toMatch(/^rcp_/);
  });
});
