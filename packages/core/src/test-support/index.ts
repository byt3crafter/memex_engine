/**
 * Shared test harness used by service-level unit tests and (later)
 * the demo:dry-run script. Spins up an isolated tempfile libSQL
 * database, applies all migrations, and returns wired services plus a
 * cleanup hook.
 *
 * Imported via the `@pantrymind/core/test-support` subpath; not
 * exported from the package's main entry on purpose so production
 * bundles can tree-shake it.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, createDb, type Db } from '@pantrymind/db';
import { createServices, type Services } from '../services/index';

export interface TestHarness {
  db: Db;
  services: Services;
  dbPath: string;
  cleanup: () => Promise<void>;
}

export async function setupTestHarness(): Promise<TestHarness> {
  const tempDir = await mkdtemp(join(tmpdir(), 'pantrymind-harness-'));
  const dbPath = join(tempDir, 'test.db');
  const { db, client } = createDb({ url: `file:${dbPath}` });
  await applyMigrations(db);
  const services = createServices(db);
  return {
    db,
    services,
    dbPath,
    cleanup: async () => {
      client.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}
