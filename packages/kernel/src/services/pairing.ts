import { and, eq, isNull } from 'drizzle-orm';
import { newPairingCode, schema, type Db } from '@memex/db';
import type {
  ConnectionKind,
  PairCompleteInput,
  PairCompleteResult,
  PairStartInput,
  PairStartResult,
  PairingCode,
} from '@memex/schemas';
import { nowIso, plusSeconds, systemClock, type Clock } from '../util/time';
import type { ConnectionService } from './connection';

export interface PairingService {
  start(userId: string, input: PairStartInput): Promise<PairStartResult>;
  complete(input: PairCompleteInput): Promise<PairCompleteResult>;
  expireOverdue(): Promise<number>;
}

export interface PairingServiceDeps {
  db: Db;
  connections: ConnectionService;
  baseUrl: string;
  clock?: Clock;
}

export function createPairingService(deps: PairingServiceDeps): PairingService {
  const { db, connections, baseUrl } = deps;
  const clock = deps.clock ?? systemClock;

  return {
    async start(userId, input) {
      const code = newPairingCode();
      const createdAt = nowIso(clock);
      const expiresAt = plusSeconds(input.expiresInSeconds, clock);
      await db.insert(schema.pairingCode).values({
        code,
        userId,
        clientName: input.clientName,
        clientKind: input.clientKind,
        scopes: [...input.scopes],
        metadata: input.metadata ?? {},
        createdAt,
        expiresAt,
        consumedAt: null,
        consumedConnectionId: null,
      });
      const qrPayload = buildQrPayload(baseUrl, code);
      const configSnippets = buildConfigSnippets({
        baseUrl,
        code,
        clientKind: input.clientKind,
      });
      return { pairingCode: code, qrPayload, configSnippets, expiresAt, baseUrl };
    },

    async complete(input) {
      const rows = await db
        .select()
        .from(schema.pairingCode)
        .where(and(eq(schema.pairingCode.code, input.code), isNull(schema.pairingCode.consumedAt)))
        .limit(1)
        .all();
      const row = rows[0];
      if (!row) throw new InvalidPairingCodeError(input.code);
      const now = clock();
      if (new Date(row.expiresAt).getTime() < now.getTime()) {
        throw new PairingCodeExpiredError(input.code);
      }
      const issued = await connections.issue({
        userId: row.userId,
        name: row.clientName,
        kind: row.clientKind as ConnectionKind,
        scopes: (row.scopes ?? []) as string[],
        metadata: {
          ...((row.metadata ?? {}) as Record<string, unknown>),
          ...(input.clientFingerprint ? { fingerprint: input.clientFingerprint } : {}),
        },
      });
      const nowIsoStr = now.toISOString();
      await db
        .update(schema.pairingCode)
        .set({ consumedAt: nowIsoStr, consumedConnectionId: issued.connection.id })
        .where(eq(schema.pairingCode.code, input.code));
      return {
        connectionId: issued.connection.id,
        token: issued.token,
        userId: issued.connection.userId,
        scopes: issued.connection.scopes,
        baseUrl,
      };
    },

    async expireOverdue() {
      const nowIsoStr = nowIso(clock);
      const rows = await db
        .select()
        .from(schema.pairingCode)
        .where(isNull(schema.pairingCode.consumedAt))
        .all();
      let n = 0;
      for (const row of rows) {
        if (row.expiresAt < nowIsoStr) {
          await db
            .update(schema.pairingCode)
            .set({ consumedAt: nowIsoStr })
            .where(eq(schema.pairingCode.code, row.code));
          n++;
        }
      }
      return n;
    },
  };
}

export class InvalidPairingCodeError extends Error {
  readonly code = 'invalid_pairing_code' as const;
  constructor(public readonly attemptedCode: string) {
    super(`pairing code ${attemptedCode} is invalid or already consumed`);
  }
}

export class PairingCodeExpiredError extends Error {
  readonly code = 'pairing_code_expired' as const;
  constructor(public readonly attemptedCode: string) {
    super(`pairing code ${attemptedCode} has expired`);
  }
}

function buildQrPayload(baseUrl: string, code: string): string {
  return `memex://pair?code=${encodeURIComponent(code)}&host=${encodeURIComponent(baseUrl)}`;
}

interface SnippetCtx {
  baseUrl: string;
  code: string;
  clientKind: ConnectionKind;
}

function buildConfigSnippets(ctx: SnippetCtx): Record<string, string> {
  const { baseUrl, code, clientKind } = ctx;

  // The MCP-stdio config snippets show the user how to wire a local
  // MCP process. The token doesn't go in the snippet because it's not
  // issued yet — pair-complete returns the token, and the assistant
  // (or website helper) writes it into the config.
  // For HTTP / MCP-SSE the assistant calls /pair-complete itself.

  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        memex: {
          command: 'node',
          args: ['/absolute/path/to/memex/apps/mcp/dist/index.js'],
          env: {
            MEMEX_BASE_URL: baseUrl,
            MEMEX_PAIRING_CODE: code,
          },
        },
      },
    },
    null,
    2,
  );

  const restCurl = [
    `# Exchange the pairing code for a long-lived token, then use it.`,
    `curl -sS -X POST "${baseUrl}/api/v1/connections/pair-complete" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"code":"${code}"}'`,
  ].join('\n');

  const generic = [
    `Pairing code: ${code}`,
    `Endpoint:     ${baseUrl}`,
    `Client kind:  ${clientKind}`,
    `QR payload:   memex://pair?code=${code}&host=${baseUrl}`,
  ].join('\n');

  return {
    claude_desktop: claudeDesktop,
    rest_curl: restCurl,
    generic,
  };
}

export type { PairingCode };
