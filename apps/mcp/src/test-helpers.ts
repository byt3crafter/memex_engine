import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '@memex/db';
import { createKernel, loadConfig, type Kernel } from '@memex/kernel';
import { foodModule } from '@memex/module-food';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { pino } from 'pino';
import { resolveMcpAuth } from './auth';
import { createMcpServer } from './server';

export const TEST_BOOTSTRAP_TOKEN = 'test-bootstrap-token-32-chars-minimum-x';

export interface McpHarness {
  kernel: Kernel;
  client: Client;
  userId: string;
  cleanup: () => Promise<void>;
}

/**
 * Spins up an isolated kernel with module-food, creates a user,
 * issues a connection, instantiates an MCP server bound to that user,
 * and links it to a Client over an in-memory transport pair.
 */
export async function setupMcpHarness(): Promise<McpHarness> {
  const tempDir = await mkdtemp(join(tmpdir(), 'memex-mcp-'));
  const dbPath = join(tempDir, 'test.db');
  const config = loadConfig(
    { MEMEX_BOOTSTRAP_TOKEN: TEST_BOOTSTRAP_TOKEN, NODE_ENV: 'test' },
    { databaseUrl: `file:${dbPath}`, bootstrapToken: TEST_BOOTSTRAP_TOKEN },
  );
  const { db, client: dbClient } = createDb({ url: `file:${dbPath}` });
  const logger = pino({ level: 'silent' });
  const kernel = await createKernel({ config, db, logger, modules: [foodModule] });

  const user = await kernel.services.users.create({ displayName: 'Dovik', timezone: 'UTC' });
  const issued = await kernel.services.connections.issue({
    userId: user.id,
    name: 'test-mcp',
    kind: 'mcp_stdio',
    scopes: ['food:read', 'food:write'],
  });
  const auth = await resolveMcpAuth(kernel, issued.token);
  const server = createMcpServer(kernel, auth);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    kernel,
    client,
    userId: user.id,
    cleanup: async () => {
      await client.close();
      await server.close();
      dbClient.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  if (res.isError) {
    const text = res.content?.[0]?.text ?? '<no content>';
    throw new Error(`tool ${name} returned error: ${text}`);
  }
  const text = res.content?.[0]?.text;
  if (text === undefined) {
    throw new Error(`tool ${name} returned no text content`);
  }
  return JSON.parse(text) as T;
}
