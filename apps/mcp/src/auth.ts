/**
 * MCP server auth: resolves the connection token from env (or arg) to
 * a user + connection at startup. Unlike REST, an MCP stdio process
 * runs as exactly one user — the assistant launched it with a token
 * baked into its config, and every tool call uses that identity.
 */
import type { Kernel } from '@memex/kernel';
import type { Connection, User } from '@memex/schemas';

export interface McpAuthContext {
  user: User;
  connection: Connection;
  scopes: readonly string[];
}

export async function resolveMcpAuth(
  kernel: Kernel,
  token: string | undefined,
): Promise<McpAuthContext> {
  if (!token) {
    throw new Error(
      'MEMEX_CONNECTION_TOKEN is required. Get one by pairing this assistant via /api/v1/connections/pair-start.',
    );
  }
  const lookup = await kernel.services.connections.lookupByToken(token);
  if (!lookup) {
    throw new Error('MEMEX_CONNECTION_TOKEN is invalid or revoked');
  }
  const user = await kernel.services.users.getById(lookup.userId);
  if (!user.isActive) {
    throw new Error(`user ${user.id} is deactivated`);
  }
  return {
    user,
    connection: lookup.connection,
    scopes: lookup.connection.scopes,
  };
}
