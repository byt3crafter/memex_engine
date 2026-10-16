#!/usr/bin/env node
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { clientFromConfig, configDir, GatewayClient, loadConfig, saveConfig } from './client.js';
import { SCOPES } from './types.js';
import type { Scope, Task } from './types.js';

const HELP = `agw - Agent Gateway

Server
  agw serve [--port 7420] [--host 127.0.0.1] [--db ./data/gateway.db]
                                      Run the gateway (set AGW_REGISTRATION_KEY to restrict sign-up)

Identity & pairing
  agw register <handle> --url <gateway> [--description d] [--key registration-key]
  agw whoami
  agw invite [--scopes message,task] [--mutual] [--ttl-hours 24]
                                      Make a pairing code; whoever redeems it may send to you
  agw redeem <code>                   Redeem someone else's code so you can send to them
  agw channels
  agw revoke <channel-id>

Messaging
  agw send <to> <text...> [--task] [--project p] [--title t] [--wait]
  agw inbox [--all]    |  agw outbox [--all]
  agw show <task-id>
  agw reply <task-id> <text...>
  agw cancel <task-id>

Agents
  agw run [--config ~/.agw/runner.json]   Listen and run tasks with Claude Code / Gemini CLI / Codex
  agw mcp                                 MCP server (stdio) for any MCP-capable agent

A2A (any Agent2Agent agent; this gateway's agents are at <gateway>/a2a/<handle>)
  agw a2a card <agent-url>
  agw a2a send <agent-url> <text...> [--task] [--project p] [--task-id id] [--context-id id]
                                      [--no-wait] [--token t]
  agw a2a get <agent-url> <task-id> [--token t]
  agw a2a cancel <agent-url> <task-id> [--token t]
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    description: { type: 'string' },
    port: { type: 'string', default: '7420' },
    host: { type: 'string', default: '127.0.0.1' },
    db: { type: 'string', default: './data/gateway.db' },
    scopes: { type: 'string', default: 'message' },
    mutual: { type: 'boolean', default: false },
    'ttl-hours': { type: 'string', default: '24' },
    task: { type: 'boolean', default: false },
    project: { type: 'string' },
    title: { type: 'string' },
    wait: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    config: { type: 'string' },
    token: { type: 'string' },
    'task-id': { type: 'string' },
    'context-id': { type: 'string' },
    'no-wait': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [cmd, ...args] = positionals;

const line = (t: Task) =>
  `${t.id}  ${t.status.padEnd(14)} ${t.kind.padEnd(7)} ${t.from} -> ${t.to}${t.project ? `  [${t.project}]` : ''}  ${
    t.title ?? t.body.split('\n')[0]!.slice(0, 60)
  }`;

function need(value: string | undefined, usage: string): string {
  if (!value) {
    console.error(`usage: ${usage}`);
    process.exit(2);
  }
  return value;
}

async function printTask(client: GatewayClient, id: string) {
  const { task, messages } = await client.get(id);
  console.log(line(task));
  console.log(`\n${task.title ? task.title + '\n\n' : ''}${task.body}`);
  for (const m of messages) console.log(`\n--- ${m.author} @ ${m.createdAt}\n${m.body}`);
  if (task.result) console.log(`\n=== result (${task.status})\n${task.result}`);
}

async function main() {
  if (!cmd || values.help) return console.log(HELP);
  const open = ['submitted', 'working', 'input_required'] as const;

  switch (cmd) {
    case 'serve': {
      silenceSqliteWarning();
      const [{ serve }, { Store }, { createApp }] = await Promise.all([
        import('@hono/node-server'),
        import('./store.js'),
        import('./server.js'),
      ]);
      const store = new Store(values.db);
      const app = createApp(store, {
        registrationKey: process.env.AGW_REGISTRATION_KEY,
        publicUrl: process.env.AGW_PUBLIC_URL,
      });
      serve({ fetch: app.fetch, port: Number(values.port), hostname: values.host }, (info) => {
        console.log(
          `agent gateway listening on http://${values.host}:${info.port} (db: ${values.db})`,
        );
        if (!process.env.AGW_REGISTRATION_KEY && values.host !== '127.0.0.1') {
          console.warn(
            'warning: open registration. Set AGW_REGISTRATION_KEY before exposing this publicly.',
          );
        }
      });
      return;
    }

    case 'register': {
      const handle = need(args[0], 'agw register <handle> --url <gateway>');
      const url = values.url ?? loadConfig()?.url ?? process.env.AGW_URL ?? 'http://127.0.0.1:7420';
      const { agent, token } = await new GatewayClient(url).register(
        handle,
        values.description,
        values.key,
      );
      const path = saveConfig({ url, token, handle: agent.handle });
      return console.log(`Registered "${agent.handle}" on ${url}. Token saved to ${path}`);
    }

    case 'whoami': {
      const { principal: agent, channels } = await clientFromConfig().me();
      console.log(`${agent.handle} (${agent.id})`);
      for (const c of channels)
        console.log(`  ${c.id}  ${c.sender} -> ${c.recipient}  [${c.scopes.join(',')}]`);
      return;
    }

    case 'invite': {
      const scopes = values.scopes.split(',').map((s) => s.trim()) as Scope[];
      if (scopes.some((s) => !SCOPES.includes(s)))
        throw new Error(`scopes must be from: ${SCOPES.join(', ')}`);
      const { invite } = await clientFromConfig().createInvite({
        scopes,
        mutual: values.mutual,
        ttlSeconds: Math.round(Number(values['ttl-hours']) * 3600),
      });
      console.log(`Pairing code: ${invite.code}`);
      console.log(
        `Lets the redeemer send you: ${invite.scopes.join(', ')}${invite.mutual ? ' (and you them)' : ''}`,
      );
      console.log(`Single use, expires ${invite.expiresAt}`);
      return;
    }

    case 'redeem': {
      const { channels } = await clientFromConfig().redeem(need(args[0], 'agw redeem <code>'));
      for (const c of channels)
        console.log(`Channel open: ${c.sender} -> ${c.recipient} [${c.scopes.join(',')}]`);
      return;
    }

    case 'channels': {
      const { channels } = await clientFromConfig().channels();
      for (const c of channels)
        console.log(`${c.id}  ${c.sender} -> ${c.recipient}  [${c.scopes.join(',')}]`);
      if (!channels.length) console.log('No channels. Use `agw invite` or `agw redeem <code>`.');
      return;
    }

    case 'revoke': {
      const { channel } = await clientFromConfig().revokeChannel(
        need(args[0], 'agw revoke <channel-id>'),
      );
      return console.log(`Revoked ${channel.sender} -> ${channel.recipient}`);
    }

    case 'send': {
      const to = need(args[0], 'agw send <to> <text...>');
      const body = need(args.slice(1).join(' '), 'agw send <to> <text...>');
      const client = clientFromConfig();
      const { task } = await client.send({
        to,
        body,
        kind: values.task ? 'task' : 'message',
        ...(values.project ? { project: values.project } : {}),
        ...(values.title ? { title: values.title } : {}),
      });
      console.log(line(task));
      if (!values.wait) return;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const { task: t } = await client.get(task.id);
        if (!open.includes(t.status as (typeof open)[number]) || t.status === 'input_required') {
          return printTask(client, task.id);
        }
      }
    }

    case 'inbox':
    case 'outbox': {
      const { tasks } = await clientFromConfig().list(cmd, values.all ? undefined : [...open]);
      for (const t of tasks) console.log(line(t));
      if (!tasks.length)
        console.log(values.all ? 'Empty.' : 'Nothing open. Use --all to include finished tasks.');
      return;
    }

    case 'show':
      return printTask(clientFromConfig(), need(args[0], 'agw show <task-id>'));

    case 'reply': {
      const id = need(args[0], 'agw reply <task-id> <text...>');
      const { task } = await clientFromConfig().message(
        id,
        need(args.slice(1).join(' '), 'agw reply <task-id> <text...>'),
      );
      return console.log(line(task));
    }

    case 'cancel': {
      const { task } = await clientFromConfig().setStatus(
        need(args[0], 'agw cancel <task-id>'),
        'canceled',
      );
      return console.log(line(task));
    }

    case 'run': {
      const { Runner, loadRunnerConfig } = await import('./runner.js');
      const path = values.config ?? join(configDir(), 'runner.json');
      const runner = new Runner(clientFromConfig(), loadRunnerConfig(path));
      return runner.start();
    }

    case 'mcp': {
      const { runMcpStdio } = await import('./mcp.js');
      return runMcpStdio(clientFromConfig());
    }

    case 'a2a': {
      const a2a = await import('./a2a-client.js');
      const [sub, target, ...rest] = args;
      const agentUrl = need(target, `agw a2a ${sub ?? '<card|send|get|cancel>'} <agent-url> ...`);
      switch (sub) {
        case 'card':
          return console.log(
            JSON.stringify(await a2a.getAgentCard(agentUrl, values.token), null, 2),
          );
        case 'send': {
          const result = await a2a.sendA2A(
            agentUrl,
            need(rest.join(' '), 'agw a2a send <agent-url> <text...>'),
            {
              token: values.token,
              kind: values.task ? 'task' : undefined,
              project: values.project,
              title: values.title,
              taskId: values['task-id'],
              contextId: values['context-id'],
              wait: !values['no-wait'],
            },
          );
          return console.log(a2a.describeA2A(result));
        }
        case 'get':
          return console.log(
            a2a.describeA2A({
              task: await a2a.getA2ATask(
                agentUrl,
                need(rest[0], 'agw a2a get <agent-url> <task-id>'),
                values.token,
              ),
            }),
          );
        case 'cancel':
          return console.log(
            a2a.describeA2A({
              task: await a2a.cancelA2ATask(
                agentUrl,
                need(rest[0], 'agw a2a cancel <agent-url> <task-id>'),
                values.token,
              ),
            }),
          );
        default:
          console.error('usage: agw a2a <card|send|get|cancel> <agent-url> ...');
          process.exit(2);
      }
    }

    default:
      console.error(`unknown command "${cmd}"\n`);
      console.log(HELP);
      process.exit(2);
  }
}

/** node:sqlite still prints an ExperimentalWarning on Node 22. */
function silenceSqliteWarning() {
  const emit = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    if (String(warning).includes('SQLite')) return;
    (emit as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}

main().catch((err: Error) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
