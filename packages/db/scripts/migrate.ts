import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyKernelMigrations, createDb } from '../src/index';

const url = process.env['MEMEX_DATABASE_URL'] ?? 'file:./data/memex.db';
const authToken = process.env['MEMEX_DATABASE_AUTH_TOKEN'];

if (url.startsWith('file:')) {
  const path = url.slice('file:'.length);
  await mkdir(dirname(path), { recursive: true });
}

const { db, client } = createDb({
  url,
  ...(authToken !== undefined ? { authToken } : {}),
});

console.log(`[migrate] applying kernel migrations to ${url}`);
await applyKernelMigrations(db);
console.log('[migrate] kernel migrations done');
client.close();
