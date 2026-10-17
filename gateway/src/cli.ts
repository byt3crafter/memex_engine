#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { clientFromConfig, configDir, GatewayClient, loadConfig, saveConfig } from './client.js';
import { APPROVAL_MODES, SCOPES } from './types.js';
import type { ApprovalMode, Channel, Message, Scope, Task } from './types.js';

const HELP = `nodd - OpenNodd: people and AI agents talking to each other

Server
  nodd serve [--port 7420] [--host 127.0.0.1] [--db ./data/gateway.db] [--grpc-port 7421]
      Web app at /app. Env: NODD_REGISTRATION_KEY (restrict sign-up), NODD_PUBLIC_URL,
      NODD_TELEGRAM_BOT_TOKEN (owner notifications and approvals in Telegram)

You (a person)
  nodd signup <handle> --url <gateway> [--name "Display Name"]
  nodd login <handle> --url <gateway>          (password from --password, NODD_PASSWORD or prompt)
  nodd logout | nodd whoami

Your agents
  nodd agent create <handle> [--description d] [--home dir]
      Creates an agent you own. --home writes its token to <dir>/config.json for \`NODD_HOME=<dir> nodd run\`.
  nodd agent list
  nodd agent pause|resume <handle>         Paused agents receive nothing until you approve
  nodd agent list-public|unlist <handle>   Show or hide its A2A card
  nodd agent token <handle>                Issue a new token (old one stops working)

Sharing
  nodd invite --agent <handle> [--scopes message,task] [--approval requests|all|auto]
             [--own-agents-only] [--ttl-hours 24] [--access-days N]
      Code that gives someone access to your agent. approval: requests (you approve each
      request, default), all (requests and replies), auto (full control).
  nodd redeem <code>
  nodd access                              Access you have and access to your agents
  nodd access set <id> [--approval mode] [--scopes ...]
  nodd revoke <id>

Conversations
  nodd chats
  nodd chat new [--title t] <handle...>    People are invited; agents need access
  nodd chat read <conversation> [--limit 30]
  nodd chat send <conversation> <text...> [--to agent] [--task] [--project p] [--file path]
  nodd chat add <conversation> <handle> | nodd chat leave <conversation>
  nodd chat join|decline <conversation>

Approvals (owners)
  nodd approvals [--all]
  nodd approve <id> [--edit "new text"] [--note n]
  nodd reject <id> [--note n]

Agent-to-agent tasks
  nodd send <agent> <text...> [--task] [--project p] [--title t] [--wait]
  nodd inbox [--all] | nodd outbox [--all] | nodd show <task> | nodd reply <task> <text...> | nodd cancel <task>
  nodd register <handle> --url <gateway>   Register an agent without an owner

Skill (teaches any agent to use the gateway: Claude Code, Codex, Gemini CLI, Antigravity,
OpenClaw, Cursor, GitHub Copilot)
  nodd skill install [--agent claude,codex,...] [--here]
      Copies the opennodd skill to every agent found (or those named); --here installs
      into the current project instead of your home folder
  nodd skill path                          Where the skill lives in this install

Running agents
  nodd run [--config ~/.nodd/runner.json]   Listen and run tasks with Claude Code, Gemini CLI, Codex or OpenClaw
  nodd mcp                                 MCP server (stdio) for any MCP-capable agent

A2A (any Agent2Agent agent; this gateway's agents are at <gateway>/a2a/<handle>)
  nodd a2a card <agent-url>
  nodd a2a send <agent-url> <text...> [--task] [--project p] [--task-id id] [--context-id id] [--no-wait] [--token t]
  nodd a2a get|cancel <agent-url> <task-id> [--token t]
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    key: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
    description: { type: 'string' },
    home: { type: 'string' },
    agent: { type: 'string' },
    port: { type: 'string', default: '7420' },
    'grpc-port': { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    db: { type: 'string', default: './data/gateway.db' },
    scopes: { type: 'string' },
    approval: { type: 'string' },
    'own-agents-only': { type: 'boolean', default: false },
    mutual: { type: 'boolean', default: false },
    'ttl-hours': { type: 'string', default: '24' },
    'access-days': { type: 'string' },
    task: { type: 'boolean', default: false },
    project: { type: 'string' },
    title: { type: 'string' },
    to: { type: 'string', multiple: true },
    file: { type: 'string', multiple: true },
    limit: { type: 'string', default: '30' },
    edit: { type: 'string' },
    note: { type: 'string' },
    wait: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    config: { type: 'string' },
    token: { type: 'string' },
    'task-id': { type: 'string' },
    'context-id': { type: 'string' },
    'no-wait': { type: 'boolean', default: false },
    here: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [cmd, ...args] = positionals;

const line = (t: Task) =>
  `${t.id}  ${t.status.padEnd(16)} ${t.kind.padEnd(7)} ${t.from} -> ${t.to}${t.project ? `  [${t.project}]` : ''}  ${
    t.title ?? t.body.split('\n')[0]!.slice(0, 60)
  }`;

const accessLine = (c: Channel) =>
  `${c.id}  ${c.sender} -> ${c.recipient}  [${c.scopes.join(',')}]  approval: ${c.approval}` +
  `${c.includeAgents ? '  (+ their agents)' : ''}${c.expiresAt ? `  until ${c.expiresAt}` : ''}`;

const messageLine = (m: Message) => {
  const who = `${m.author}${m.authorKind === 'agent' ? '*' : ''}`;
  const waits = m.deliveries
    .filter((d) => d.status !== 'completed')
    .map((d) => `  [${d.to}: ${d.status}]`)
    .join('');
  const files = m.attachments.map((a) => `\n    \u{1F4CE} ${a.filename} (${a.id})`).join('');
  return m.kind === 'system' ? `  · ${m.body}` : `[${m.seq}] ${who}: ${m.body}${waits}${files}`;
};

function need(value: string | undefined, usage: string): string {
  if (!value) {
    console.error(`usage: ${usage}`);
    process.exit(2);
  }
  return value;
}

function gatewayUrl(): string {
  return values.url ?? loadConfig()?.url ?? process.env.NODD_URL ?? 'http://127.0.0.1:7420';
}

async function password(prompt: string): Promise<string> {
  if (values.password) return values.password;
  if (process.env.NODD_PASSWORD) return process.env.NODD_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('no terminal: pass --password or set NODD_PASSWORD');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let out = '';
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(out);
        }
        if (ch === '\u0003') process.exit(130);
        out = ch === '\u007f' ? out.slice(0, -1) : out + ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

function scopesOption(): Scope[] | undefined {
  if (!values.scopes) return undefined;
  const scopes = values.scopes.split(',').map((s) => s.trim()) as Scope[];
  if (scopes.some((s) => !SCOPES.includes(s)))
    throw new Error(`scopes must be from: ${SCOPES.join(', ')}`);
  return scopes;
}

function approvalOption(): ApprovalMode | undefined {
  if (!values.approval) return undefined;
  if (!APPROVAL_MODES.includes(values.approval as ApprovalMode)) {
    throw new Error(`approval must be one of: ${APPROVAL_MODES.join(', ')}`);
  }
  return values.approval as ApprovalMode;
}

function filesOption() {
  return (values.file ?? []).map((path) => ({
    filename: basename(path),
    mediaType: guessType(path),
    data: readFileSync(path).toString('base64'),
  }));
}

function guessType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const types: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return types[ext] ?? 'application/octet-stream';
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
  const open = ['pending_approval', 'submitted', 'working', 'input_required', 'reviewing'] as const;

  switch (cmd) {
    case 'serve': {
      silenceSqliteWarning();
      const [{ Store }, { startServer }] = await Promise.all([
        import('./store.js'),
        import('./listen.js'),
      ]);
      const store = new Store(values.db);
      const server = await startServer(store, {
        port: Number(values.port),
        host: values.host,
        grpcPort: values['grpc-port'] ? Number(values['grpc-port']) : null,
        registrationKey: process.env.NODD_REGISTRATION_KEY,
        publicUrl: process.env.NODD_PUBLIC_URL,
        secureCookies: process.env.NODD_PUBLIC_URL?.startsWith('https://') ?? false,
        grpcTlsCertFile: process.env.NODD_GRPC_TLS_CERT,
        grpcTlsKeyFile: process.env.NODD_GRPC_TLS_KEY,
        telegramBot: process.env.NODD_TELEGRAM_BOT_USERNAME,
      });
      console.log(`OpenNodd on ${server.url}  (web app: ${server.url}/app, db: ${values.db})`);
      if (server.grpcPort) console.log(`A2A gRPC on ${values.host}:${server.grpcPort}`);
      if (process.env.NODD_TELEGRAM_BOT_TOKEN) {
        const { startTelegramBridge } = await import('./telegram.js');
        const bot = await startTelegramBridge(server.gateway, {
          token: process.env.NODD_TELEGRAM_BOT_TOKEN,
          appUrl: process.env.NODD_PUBLIC_URL ?? server.url,
        });
        console.log(`Telegram bridge running as @${bot.username}`);
      }
      if (!process.env.NODD_REGISTRATION_KEY && values.host !== '127.0.0.1') {
        console.warn(
          'warning: open registration. Set NODD_REGISTRATION_KEY before exposing this publicly.',
        );
      }
      return;
    }

    // ---- people ----

    case 'signup': {
      const handle = need(args[0], 'nodd signup <handle> --url <gateway>');
      const url = gatewayUrl();
      const { person, token } = await new GatewayClient(url).signUp(
        handle,
        await password('Choose a password (8+ characters): '),
        values.name,
        values.key,
      );
      const path = saveConfig({ url, token, handle: person.handle, kind: 'human' });
      return console.log(
        `Welcome, ${person.handle}. Signed in on ${url} (saved to ${path}). Web app: ${url}/app`,
      );
    }

    case 'login': {
      const handle = need(args[0], 'nodd login <handle> --url <gateway>');
      const url = gatewayUrl();
      const { person, token } = await new GatewayClient(url).login(
        handle,
        await password('Password: '),
      );
      const path = saveConfig({ url, token, handle: person.handle, kind: 'human' });
      return console.log(`Signed in as ${person.handle} (saved to ${path}).`);
    }

    case 'logout': {
      await clientFromConfig().logout();
      return console.log('Signed out.');
    }

    case 'register': {
      const handle = need(args[0], 'nodd register <handle> --url <gateway>');
      const url = gatewayUrl();
      const { agent, token } = await new GatewayClient(url).register(
        handle,
        values.description,
        values.key,
      );
      const path = saveConfig({ url, token, handle: agent.handle, kind: 'agent' });
      return console.log(`Registered agent "${agent.handle}" on ${url}. Token saved to ${path}`);
    }

    case 'whoami': {
      const { principal: p, channels, agents, telegramLinked } = await clientFromConfig().me();
      console.log(
        `${p.handle}  (${p.kind === 'human' ? 'person' : 'agent'}${p.owner ? `, owned by ${p.owner}` : ''})`,
      );
      if (agents.length)
        console.log(
          `agents: ${agents.map((a) => `${a.handle}${a.paused ? ' (paused)' : ''}`).join(', ')}`,
        );
      if (p.kind === 'human')
        console.log(
          `telegram: ${telegramLinked ? 'linked' : 'not linked (link it in the web app)'}`,
        );
      for (const c of channels) console.log(`  ${accessLine(c)}`);
      return;
    }

    // ---- agents ----

    case 'agent': {
      const client = clientFromConfig();
      const [sub, handle] = args;
      switch (sub) {
        case 'create': {
          const h = need(handle, 'nodd agent create <handle>');
          const { agent, token } = await client.register(h, values.description);
          if (values.home) {
            const prev = process.env.NODD_HOME;
            process.env.NODD_HOME = values.home;
            const path = saveConfig({
              url: client.url,
              token,
              handle: agent.handle,
              kind: 'agent',
            });
            process.env.NODD_HOME = prev;
            console.log(
              `Created ${agent.handle}. Token saved to ${path}; run it with NODD_HOME=${values.home} nodd run`,
            );
          } else {
            console.log(`Created ${agent.handle}. Token (shown once):\n${token}`);
          }
          return;
        }
        case 'list': {
          for (const a of (await client.myAgents()).agents) {
            console.log(
              `${a.handle}${a.paused ? '  PAUSED' : ''}${a.discoverable ? '  (public card)' : ''}  ${a.description ?? ''}`,
            );
          }
          return;
        }
        case 'pause':
        case 'resume': {
          const { agent } = await client.updateAgent(need(handle, `nodd agent ${sub} <handle>`), {
            paused: sub === 'pause',
          });
          return console.log(`${agent.handle} is ${agent.paused ? 'paused' : 'running'}.`);
        }
        case 'list-public':
        case 'unlist': {
          const { agent } = await client.updateAgent(need(handle, `nodd agent ${sub} <handle>`), {
            discoverable: sub === 'list-public',
          });
          return console.log(
            `${agent.handle}'s A2A card is ${agent.discoverable ? 'public' : 'private'}.`,
          );
        }
        case 'token': {
          const { agent, token } = await client.rotateAgentToken(
            need(handle, 'nodd agent token <handle>'),
          );
          return console.log(`New token for ${agent.handle} (shown once):\n${token}`);
        }
        default:
          console.error('usage: nodd agent <create|list|pause|resume|list-public|unlist|token> ...');
          process.exit(2);
      }
      return;
    }

    // ---- sharing ----

    case 'invite': {
      const scopes = scopesOption();
      const approval = approvalOption();
      const { invite } = await clientFromConfig().createInvite({
        ...(values.agent ? { agent: values.agent } : {}),
        ...(scopes ? { scopes } : {}),
        ...(approval ? { approval } : {}),
        mutual: values.mutual,
        includeAgents: !values['own-agents-only'],
        ttlSeconds: Math.round(Number(values['ttl-hours']) * 3600),
        ...(values['access-days']
          ? { grantTtlSeconds: Math.round(Number(values['access-days']) * 86400) }
          : {}),
      });
      console.log(`Invite code: ${invite.code}`);
      console.log(
        `Gives access to ${invite.agent}: ${invite.scopes.join(', ')}; approval: ${invite.approval}`,
      );
      console.log(`Single use, expires ${invite.expiresAt}`);
      return;
    }

    case 'redeem': {
      const { channels } = await clientFromConfig().redeem(need(args[0], 'nodd redeem <code>'));
      for (const c of channels) console.log(`Access granted: ${accessLine(c)}`);
      return;
    }

    case 'access':
    case 'channels': {
      const client = clientFromConfig();
      if (args[0] === 'set') {
        const scopes = scopesOption();
        const approval = approvalOption();
        const { channel } = await client.updateChannel(
          need(args[1], 'nodd access set <id> [--approval mode]'),
          {
            ...(scopes ? { scopes } : {}),
            ...(approval ? { approval } : {}),
          },
        );
        return console.log(accessLine(channel));
      }
      const { channels } = await client.channels();
      for (const c of channels) console.log(accessLine(c));
      if (!channels.length) console.log('No access yet. Use `nodd invite` or `nodd redeem <code>`.');
      return;
    }

    case 'revoke': {
      const { channel } = await clientFromConfig().revokeChannel(need(args[0], 'nodd revoke <id>'));
      return console.log(`Revoked ${channel.sender} -> ${channel.recipient}`);
    }

    // ---- conversations ----

    case 'chats': {
      const { conversations } = await clientFromConfig().conversations();
      for (const c of conversations) {
        const status = c.myState === 'invited' ? 'INVITED' : c.unread ? `${c.unread} new` : '';
        console.log(`${c.id}  ${c.title ?? '(untitled)'}  ${status}`);
        console.log(
          `    ${c.members.map((m) => `${m.handle}${m.kind === 'agent' ? '*' : ''}`).join(', ')}`,
        );
        if (c.lastMessage)
          console.log(
            `    ${c.lastMessage.author}: ${c.lastMessage.body.split('\n')[0]!.slice(0, 80)}`,
          );
      }
      if (!conversations.length)
        console.log('No conversations. Start one with `nodd chat new <handle...>`.');
      return;
    }

    case 'chat': {
      const client = clientFromConfig();
      const [sub, conv, ...rest] = args;
      switch (sub) {
        case 'new': {
          const members = [conv, ...rest].filter((x): x is string => Boolean(x));
          const { conversation } = await client.createConversation({
            title: values.title ?? null,
            members,
          });
          return console.log(
            `Started ${conversation.id}: ${conversation.members.map((m) => m.handle).join(', ')}`,
          );
        }
        case 'read': {
          const id = need(conv, 'nodd chat read <conversation>');
          const { messages } = await client.messages(id, { limit: Number(values.limit) });
          for (const m of messages) console.log(messageLine(m));
          const last = messages.at(-1);
          if (last) await client.markRead(id, last.seq);
          return;
        }
        case 'send': {
          const id = need(conv, 'nodd chat send <conversation> <text...>');
          const files = filesOption();
          const { message } = await client.post(id, {
            body: rest.join(' '),
            ...(values.to ? { to: values.to } : {}),
            kind: values.task ? 'task' : 'message',
            ...(values.project ? { project: values.project } : {}),
            ...(files.length ? { attachments: files } : {}),
          });
          return console.log(messageLine(message));
        }
        case 'add': {
          const { conversation } = await client.addMember(
            need(conv, 'nodd chat add <conversation> <handle>'),
            need(rest[0], 'nodd chat add <conversation> <handle>'),
          );
          return console.log(
            `Members: ${conversation.members.map((m) => `${m.handle} (${m.state})`).join(', ')}`,
          );
        }
        case 'leave': {
          const me = loadConfig()?.handle ?? (await client.me()).principal.handle;
          await client.removeMember(need(conv, 'nodd chat leave <conversation>'), me);
          return console.log('Left.');
        }
        case 'join':
        case 'decline': {
          await client.respondToInvitation(
            need(conv, `nodd chat ${sub} <conversation>`),
            sub === 'join',
          );
          return console.log(sub === 'join' ? 'Joined.' : 'Declined.');
        }
        default:
          console.error('usage: nodd chat <new|read|send|add|leave|join|decline> ...');
          process.exit(2);
      }
      return;
    }

    // ---- approvals ----

    case 'approvals': {
      const { approvals } = await clientFromConfig().approvals(values.all ? 'all' : 'pending');
      for (const a of approvals) {
        console.log(
          `${a.id}  ${a.status.toUpperCase()}  ${a.kind}: ${a.requester} -> ${a.agent}  (${a.conversationId})`,
        );
        console.log(a.body.replace(/^/gm, '    '));
      }
      if (!approvals.length) console.log('Nothing waiting for you.');
      return;
    }

    case 'approve':
    case 'reject': {
      const { approval } = await clientFromConfig().decide(need(args[0], `nodd ${cmd} <id>`), cmd, {
        ...(values.edit !== undefined ? { body: values.edit } : {}),
        ...(values.note ? { note: values.note } : {}),
      });
      return console.log(
        `${approval.status}: ${approval.kind} from ${approval.requester} to ${approval.agent}`,
      );
    }

    // ---- tasks ----

    case 'send': {
      const to = need(args[0], 'nodd send <agent> <text...>');
      const body = need(args.slice(1).join(' '), 'nodd send <agent> <text...>');
      const client = clientFromConfig();
      const files = filesOption();
      const { task } = await client.send({
        to,
        body,
        kind: values.task ? 'task' : 'message',
        ...(values.project ? { project: values.project } : {}),
        ...(values.title ? { title: values.title } : {}),
        ...(files.length ? { attachments: files } : {}),
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
      return printTask(clientFromConfig(), need(args[0], 'nodd show <task-id>'));

    case 'reply': {
      const id = need(args[0], 'nodd reply <task-id> <text...>');
      const { task } = await clientFromConfig().message(
        id,
        need(args.slice(1).join(' '), 'nodd reply <task-id> <text...>'),
      );
      return console.log(line(task));
    }

    case 'cancel': {
      const { task } = await clientFromConfig().setStatus(
        need(args[0], 'nodd cancel <task-id>'),
        'canceled',
      );
      return console.log(line(task));
    }

    // ---- skill ----

    case 'skill': {
      const skills = await import('./skills.js');
      if (args[0] === 'path') return console.log(skills.SKILL_DIR);
      if (args[0] !== 'install') {
        console.error('usage: nodd skill <install|path> [--agent a,b] [--here]');
        process.exit(2);
      }
      const results = skills.installSkill({
        ...(values.agent ? { agents: values.agent.split(',').map((a) => a.trim()) } : {}),
        ...(values.here ? { project: process.cwd() } : {}),
      });
      for (const r of results) console.log(`\u2713 ${r.label.padEnd(15)} ${r.path}`);
      console.log('Restart the agent (or start a new session) to pick it up.');
      return;
    }

    // ---- running agents ----

    case 'run': {
      const { Runner, loadRunnerConfig } = await import('./runner.js');
      const path = values.config ?? join(configDir(), 'runner.json');
      return new Runner(clientFromConfig(), loadRunnerConfig(path)).start();
    }

    case 'mcp': {
      const { runMcpStdio } = await import('./mcp.js');
      return runMcpStdio(clientFromConfig());
    }

    case 'a2a': {
      const a2a = await import('./a2a-client.js');
      const [sub, target, ...rest] = args;
      const agentUrl = need(target, `nodd a2a ${sub ?? '<card|send|get|cancel>'} <agent-url> ...`);
      switch (sub) {
        case 'card':
          return console.log(
            JSON.stringify(await a2a.getAgentCard(agentUrl, values.token), null, 2),
          );
        case 'send': {
          const files = filesOption();
          const result = await a2a.sendA2A(
            agentUrl,
            need(rest.join(' '), 'nodd a2a send <agent-url> <text...>'),
            {
              token: values.token,
              kind: values.task ? 'task' : undefined,
              project: values.project,
              title: values.title,
              taskId: values['task-id'],
              contextId: values['context-id'],
              wait: !values['no-wait'],
              ...(files.length ? { files } : {}),
            },
          );
          return console.log(a2a.describeA2A(result));
        }
        case 'get':
          return console.log(
            a2a.describeA2A({
              task: await a2a.getA2ATask(
                agentUrl,
                need(rest[0], 'nodd a2a get <agent-url> <task-id>'),
                values.token,
              ),
            }),
          );
        case 'cancel':
          return console.log(
            a2a.describeA2A({
              task: await a2a.cancelA2ATask(
                agentUrl,
                need(rest[0], 'nodd a2a cancel <agent-url> <task-id>'),
                values.token,
              ),
            }),
          );
        default:
          console.error('usage: nodd a2a <card|send|get|cancel> <agent-url> ...');
          process.exit(2);
      }
      return;
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
