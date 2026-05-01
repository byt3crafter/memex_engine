import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema/index';

export type Schema = typeof schema;
export type Db = LibSQLDatabase<Schema>;

export interface CreateDbOptions {
  url: string;
  authToken?: string;
}

export function createDb(options: CreateDbOptions): { db: Db; client: Client } {
  const client = createClient({
    url: options.url,
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
  });
  const db = drizzle(client, { schema });
  return { db, client };
}
