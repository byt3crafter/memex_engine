/**
 * Memex MCP server — a thin bridge between the @modelcontextprotocol
 * TypeScript SDK and the kernel's module registry.
 *
 *   for module in kernel.modules:
 *     for tool in module.buildMcpTools(services):
 *       mcp.registerTool(tool.name, tool.description, tool.inputSchema,
 *                         (args) => tool.handler(args, mcpHandlerContext))
 *
 * Tools never see the bearer token directly — auth resolves once at
 * startup and the userId is passed into every handler invocation.
 */
import type { Kernel, McpToolContribution } from '@memex/kernel';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import type { McpAuthContext } from './auth';

const PRODUCT = { name: 'memex', version: '0.0.1-alpha' } as const;

export function createMcpServer(kernel: Kernel, auth: McpAuthContext): McpServer {
  const server = new McpServer(
    { name: PRODUCT.name, version: PRODUCT.version },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
    },
  );

  const tools: { module: string; tool: McpToolContribution }[] = [];
  for (const entry of kernel.modules.list()) {
    const moduleId = entry.module.manifest.id;
    const moduleTools = entry.module.buildMcpTools?.(entry.services) ?? [];
    for (const tool of moduleTools) {
      tools.push({ module: moduleId, tool });
    }
  }

  // Built-in kernel tools — no module owns these.
  tools.push({
    module: 'kernel',
    tool: {
      name: 'memex_whoami',
      description:
        'Return the resolved user and connection for the current MCP session, plus which modules are loaded.',
      inputSchema: z.object({}),
      handler: async (_input, _ctx) =>
        ({
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                user: { id: auth.user.id, displayName: auth.user.displayName },
                connection: {
                  id: auth.connection.id,
                  name: auth.connection.name,
                  kind: auth.connection.kind,
                },
                modules: kernel.modules.ids(),
                scopes: auth.scopes,
              }),
            },
          ],
        }) satisfies { content: { type: 'text'; text: string }[] },
    },
  });

  for (const { module, tool } of tools) {
    registerTool(server, module, tool, auth);
  }

  return server;
}

function registerTool(
  server: McpServer,
  module: string,
  tool: McpToolContribution,
  auth: McpAuthContext,
): void {
  const shape = extractShape(tool.inputSchema);
  // Use the older `tool(name, desc, shape, handler)` overload — it
  // unwraps `args` into a parsed object and is consistent across SDK
  // 1.0.x minor versions.
  server.tool(tool.name, `[${module}] ${tool.description}`, shape, async (args: unknown) => {
    try {
      const input =
        shape['input'] !== undefined && Object.keys(shape).length === 1
          ? (args as { input: unknown }).input
          : args;
      const result = await tool.handler(input, {
        userId: auth.user.id,
        connectionId: auth.connection.id,
        scopes: auth.scopes,
      });
      return result as { content: { type: 'text'; text: string }[] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
      };
    }
  });
}

/**
 * Extract a ZodRawShape from a top-level z.object() schema. The SDK's
 * registerTool() wants `.shape` (a record of zod types), not the full
 * schema. Unwraps z.union etc. by parsing the input through the full
 * schema inside handlers — the SDK only uses shape for tool listing.
 */
function extractShape(schema: ZodTypeAny): Record<string, ZodTypeAny> {
  if (schema instanceof z.ZodObject) {
    return schema.shape as Record<string, ZodTypeAny>;
  }
  // Union / discriminated union: present as a single `input` field, the
  // tool handler validates with its own Zod parse.
  return { input: schema };
}
