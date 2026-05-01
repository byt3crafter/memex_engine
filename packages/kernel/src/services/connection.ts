import { and, eq, isNull } from 'drizzle-orm';
import { KernelIdPrefix, newId, schema, type Db } from '@memex/db';
import type { Connection, ConnectionKind, Scope } from '@memex/schemas';
import { hashToken, newToken } from '../util/hash';
import { nowIso, systemClock, type Clock } from '../util/time';

export interface IssueConnectionInput {
  userId: string;
  name: string;
  kind: ConnectionKind;
  scopes?: readonly string[];
  metadata?: Record<string, unknown>;
}

export interface IssuedConnection {
  connection: Connection;
  /** Cleartext token. Returned ONCE; never persisted. */
  token: string;
}

export interface ConnectionLookup {
  connection: Connection;
  userId: string;
}

export interface ConnectionService {
  issue(input: IssueConnectionInput): Promise<IssuedConnection>;
  lookupByToken(token: string): Promise<ConnectionLookup | undefined>;
  listForUser(userId: string): Promise<Connection[]>;
  revoke(id: string, userId: string): Promise<Connection>;
  touchLastUsed(id: string): Promise<void>;
}

export interface ConnectionServiceDeps {
  db: Db;
  clock?: Clock;
}

export function createConnectionService(deps: ConnectionServiceDeps): ConnectionService {
  const { db } = deps;
  const clock = deps.clock ?? systemClock;

  function rowToConnection(row: typeof schema.connection.$inferSelect): Connection {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      kind: row.kind as ConnectionKind,
      tokenPrefix: row.tokenPrefix,
      scopes: (row.scopes ?? []) as Scope[],
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function findById(id: string, userId: string) {
    const rows = await db
      .select()
      .from(schema.connection)
      .where(and(eq(schema.connection.id, id), eq(schema.connection.userId, userId)))
      .limit(1)
      .all();
    return rows[0];
  }

  return {
    async issue(input) {
      const { token, prefix } = newToken('mx');
      const tokenHash = hashToken(token);
      const id = newId(KernelIdPrefix.connection);
      const now = nowIso(clock);
      await db.insert(schema.connection).values({
        id,
        userId: input.userId,
        name: input.name,
        kind: input.kind,
        tokenHash,
        tokenPrefix: prefix,
        scopes: [...(input.scopes ?? [])],
        metadata: input.metadata ?? {},
        lastUsedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      const rows = await db
        .select()
        .from(schema.connection)
        .where(eq(schema.connection.id, id))
        .all();
      const row = rows[0];
      if (!row) throw new Error('connection vanished after insert');
      return { connection: rowToConnection(row), token };
    },

    async lookupByToken(token) {
      const tokenHash = hashToken(token);
      const rows = await db
        .select()
        .from(schema.connection)
        .where(and(eq(schema.connection.tokenHash, tokenHash), isNull(schema.connection.revokedAt)))
        .limit(1)
        .all();
      const row = rows[0];
      if (!row) return undefined;
      return { connection: rowToConnection(row), userId: row.userId };
    },

    async listForUser(userId) {
      const rows = await db
        .select()
        .from(schema.connection)
        .where(eq(schema.connection.userId, userId))
        .all();
      return rows.map(rowToConnection);
    },

    async revoke(id, userId) {
      const existing = await findById(id, userId);
      if (!existing) throw new ConnectionNotFoundError(id);
      const now = nowIso(clock);
      await db
        .update(schema.connection)
        .set({ revokedAt: now, updatedAt: now })
        .where(eq(schema.connection.id, id));
      const rows = await db
        .select()
        .from(schema.connection)
        .where(eq(schema.connection.id, id))
        .all();
      return rowToConnection(rows[0]!);
    },

    async touchLastUsed(id) {
      const now = nowIso(clock);
      await db
        .update(schema.connection)
        .set({ lastUsedAt: now })
        .where(eq(schema.connection.id, id));
    },
  };
}

export class ConnectionNotFoundError extends Error {
  readonly code = 'connection_not_found' as const;
  constructor(public readonly id: string) {
    super(`connection ${id} not found`);
  }
}
