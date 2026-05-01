import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const url = process.env['HEALTHLOOP_DATABASE_URL'] ?? 'file:./data/pantrymind.db';
const authToken = process.env['HEALTHLOOP_DATABASE_AUTH_TOKEN'];

if (url.startsWith('file:')) {
  const path = url.slice('file:'.length);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
}

const client = createClient({ url, ...(authToken !== undefined ? { authToken } : {}) });
const db = drizzle(client);

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = `${here}/../drizzle`;

console.log(`[migrate] applying migrations from ${migrationsFolder} to ${url}`);
await migrate(db, { migrationsFolder });
console.log('[migrate] done');
client.close();
