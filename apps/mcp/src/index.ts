/**
 * Stdio MCP server entry point. Run as a subprocess by an assistant
 * (Claude Desktop / OpenClaw / Cursor / etc.) and pass the connection
 * token via env:
 *
 *   MEMEX_CONNECTION_TOKEN=mx_… node dist/index.js
 */
import { createDb } from '@memex/db';
import { createKernel, loadConfig } from '@memex/kernel';
import { foodModule } from '@memex/module-food';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pino } from 'pino';
import { resolveMcpAuth } from './auth';
import { createMcpServer } from './server';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

const { db, client } = createDb({
  url: config.databaseUrl,
  ...(config.databaseAuthToken !== undefined ? { authToken: config.databaseAuthToken } : {}),
});

const kernel = await createKernel({ config, db, client, logger, modules: [foodModule] });
const auth = await resolveMcpAuth(kernel, process.env['MEMEX_CONNECTION_TOKEN']);
const server = createMcpServer(kernel, auth);

const transport = new StdioServerTransport();
await server.connect(transport);
logger.info(
  { user: auth.user.id, connection: auth.connection.id, modules: kernel.modules.ids() },
  'memex.mcp.connected',
);
