import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { GatewayClient } from './client.js';
import { escape, fenceTask, UNTRUSTED_NOTE } from './fence.js';
import { TERMINAL_STATUSES } from './types.js';
import type { Task } from './types.js';

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] });

const summary = (t: Task) =>
  `${t.id}  [${t.status}]  ${t.kind}  ${t.from} -> ${t.to}${t.project ? `  project=${t.project}` : ''}${t.title ? `  "${t.title}"` : ''}`;

/** MCP tools that let any MCP-capable agent (Claude Code, Gemini CLI, Codex, ...) use the gateway. */
export function createMcpServer(client: GatewayClient): McpServer {
  const server = new McpServer({ name: 'agent-gateway', version: '0.1.0' });

  const run = async (fn: () => Promise<string>) => {
    try {
      return text(await fn());
    } catch (err) {
      return { ...text(`Gateway error: ${(err as Error).message}`), isError: true };
    }
  };

  server.registerTool(
    'gateway_whoami',
    { description: 'Show this agent’s gateway handle and the channels it can send or receive on.' },
    () =>
      run(async () => {
        const { agent, channels } = await client.me();
        const lines = channels.map(
          (c) => `  ${c.id}: ${c.sender} -> ${c.recipient} [${c.scopes.join(',')}]`,
        );
        return `You are "${agent.handle}".\nChannels:\n${lines.join('\n') || '  (none - create or redeem an invite code)'}`;
      }),
  );

  server.registerTool(
    'gateway_send',
    {
      description:
        'Send a message or task to another agent. kind="message" for questions/discussion, kind="task" for work ' +
        'that may change things. Requires a channel (redeem the other agent’s invite code first). Returns the task id.',
      inputSchema: {
        to: z.string().describe('Recipient agent handle'),
        body: z.string().describe('What you want the other agent to know or do'),
        kind: z.enum(['message', 'task']).default('message'),
        project: z
          .string()
          .optional()
          .describe('Project name the recipient’s runner maps to a folder'),
        title: z.string().optional(),
      },
    },
    (args) =>
      run(async () => {
        const { task } = await client.send(dropUndefined(args));
        return `Sent. ${summary(task)}\nUse gateway_wait_for_task to wait for the result.`;
      }),
  );

  server.registerTool(
    'gateway_inbox',
    {
      description: 'List tasks/messages sent to you (box="inbox") or by you (box="outbox").',
      inputSchema: {
        box: z.enum(['inbox', 'outbox']).default('inbox'),
        open_only: z.boolean().default(true).describe('Hide finished tasks'),
      },
    },
    ({ box, open_only }) =>
      run(async () => {
        const status = open_only
          ? (['submitted', 'working', 'input_required'] as const)
          : undefined;
        const { tasks } = await client.list(box, status ? [...status] : undefined);
        return tasks.map(summary).join('\n') || 'Nothing here.';
      }),
  );

  server.registerTool(
    'gateway_get_task',
    {
      description: 'Read a task with its full thread and result.',
      inputSchema: { task_id: z.string() },
    },
    ({ task_id }) => run(async () => describeTask(client, task_id)),
  );

  server.registerTool(
    'gateway_reply',
    {
      description:
        'Add a message to a task thread. If you sent the task and the other agent asked for input, this answers it ' +
        'and puts the task back in their queue.',
      inputSchema: { task_id: z.string(), body: z.string() },
    },
    ({ task_id, body }) =>
      run(async () => {
        const { task } = await client.message(task_id, body);
        return `Replied. ${summary(task)}`;
      }),
  );

  server.registerTool(
    'gateway_update_task',
    {
      description:
        'Change a task’s status. As recipient: working, input_required, completed, failed or rejected (with a ' +
        'result). As sender: canceled.',
      inputSchema: {
        task_id: z.string(),
        status: z.enum([
          'working',
          'input_required',
          'completed',
          'failed',
          'rejected',
          'canceled',
        ]),
        result: z.string().optional(),
      },
    },
    ({ task_id, status, result }) =>
      run(async () => {
        const { task } = await client.setStatus(task_id, status, result);
        return `Updated. ${summary(task)}`;
      }),
  );

  server.registerTool(
    'gateway_wait_for_task',
    {
      description:
        'Wait until a task finishes or needs input, then return it. Times out after timeout_seconds.',
      inputSchema: {
        task_id: z.string(),
        timeout_seconds: z.number().int().min(1).max(600).default(120),
      },
    },
    ({ task_id, timeout_seconds }) =>
      run(async () => {
        const deadline = Date.now() + timeout_seconds * 1000;
        for (;;) {
          const { task } = await client.get(task_id);
          if (TERMINAL_STATUSES.includes(task.status) || task.status === 'input_required') {
            return describeTask(client, task_id);
          }
          if (Date.now() > deadline)
            return `Still ${task.status} after ${timeout_seconds}s. ${summary(task)}`;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }),
  );

  server.registerTool(
    'gateway_create_invite',
    {
      description:
        'Create a pairing code. Whoever redeems it may send to you with the given scopes. Share the code with the ' +
        'other agent’s owner. mutual=true also lets you send to them.',
      inputSchema: {
        scopes: z.array(z.enum(['message', 'task'])).default(['message']),
        mutual: z.boolean().default(false),
        ttl_hours: z.number().min(0.1).max(168).default(24),
      },
    },
    ({ scopes, mutual, ttl_hours }) =>
      run(async () => {
        const { invite } = await client.createInvite({
          scopes,
          mutual,
          ttlSeconds: Math.round(ttl_hours * 3600),
        });
        return `Invite code: ${invite.code}\nScopes: ${invite.scopes.join(', ')}${invite.mutual ? ' (mutual)' : ''}\nExpires: ${invite.expiresAt}\nSingle use.`;
      }),
  );

  server.registerTool(
    'gateway_redeem_invite',
    {
      description:
        'Redeem a pairing code from another agent, opening a channel so you can send to it.',
      inputSchema: { code: z.string() },
    },
    ({ code }) =>
      run(async () => {
        const { channels } = await client.redeem(code);
        return channels
          .map((c) => `Channel ${c.id}: ${c.sender} -> ${c.recipient} [${c.scopes.join(',')}]`)
          .join('\n');
      }),
  );

  return server;
}

async function describeTask(client: GatewayClient, id: string): Promise<string> {
  const { task, messages } = await client.get(id);
  return [
    summary(task),
    UNTRUSTED_NOTE,
    fenceTask(task, messages),
    task.result
      ? `Result:\n<agent_message from="${task.to}" trust="untrusted">\n${escape(task.result)}\n</agent_message>`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function dropUndefined<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;
}

export async function runMcpStdio(client: GatewayClient): Promise<void> {
  await createMcpServer(client).connect(new StdioServerTransport());
}
