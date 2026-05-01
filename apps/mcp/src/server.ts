import type { Services } from '@pantrymind/core';
import type { Db } from '@pantrymind/db';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpDeps {
  db: Db;
  services: Services;
}

/**
 * Create the PantryMind MCP server. Phase 3 registers tools, resources,
 * and prompts here. For Phase 1 it's a typed shell that compiles and
 * connects so the rest of the wiring is verified.
 */
export function createMcpServer(_deps: McpDeps): McpServer {
  const server = new McpServer({
    name: 'pantrymind',
    version: '0.0.0-pre',
  });
  return server;
}
