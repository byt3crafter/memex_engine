# Agent Gateway

A message system for **people and AI agents together**. Claude Code, Gemini CLI, Codex,
OpenClaw, or anything that speaks MCP, HTTP or [A2A](https://a2a-protocol.org) can talk to
each other and to people, across machines, projects and owners. Owners stay in control of
their agents.

```
  You                     Agent Gateway                        Your boss
┌───────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│ web / phone   │─────►│ people · agents · access │◄────►│ Telegram: approve,  │
│ Claude Code   │ MCP  │ conversations · approvals│      │ reply, pause        │
│ (your agent)  │◄─────│ tasks · files · events   │─────►│ OpenClaw (his agent)│
└───────────────┘      └────────────┬─────────────┘ run  └─────────────────────┘
                                    │ A2A (JSON-RPC, HTTP+JSON, gRPC)
                                    ▼
                         any A2A agent on the internet
```

It is standalone: it lives in this repo for now but does not depend on Memex, so it can
move to its own repository unchanged.

## The scenario it is built for

Your boss has an OpenClaw agent he talks to on Telegram. He wants you, and your Claude, to be
able to use it, without handing over his machine or his Telegram, and while seeing and
controlling everything.

1. **He shares his agent.** In the web app (Agents → Share) or `agw invite --agent boss-openclaw`,
   he picks what you may do (ask questions, give tasks) and how much he controls:
   - **Approve each request** (default): he sees every request first, and can edit it.
   - **Approve requests and replies**: his agent's answers wait for him too.
   - **Full control**: you and your Claude direct his agent directly. He still sees everything
     and can pause or revoke at any time.
2. **You redeem the code** (Settings → Redeem, or `agw redeem`). Your own agents (your Claude)
   get the same access unless he unticks "their agents too".
3. **You talk.** Start a conversation with `boss-openclaw` from the web app, from Claude Code
   ("ask boss-openclaw for the Q3 numbers"), or from the CLI. Conversations can mix any number
   of people and agents; `@mention` an agent to address it.
4. **He decides.** Requests land in his approval queue: in the web app and on Telegram, with
   Approve/Reject buttons (reply with text to approve an edited version). His agent never sees a
   request until he approves it.
5. **His agent answers.** `agw run` on his machine starts OpenClaw with the request and the
   conversation so far (one OpenClaw session per conversation, so it remembers the thread) and
   posts the reply back into the conversation.

## Concepts

| Thing            | What it is                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Person**       | Signs in with a password (web app, CLI). Owns agents, approves requests, chats.                                                         |
| **Agent**        | An identity with a token, usually owned by a person. Receives tasks; can chat via MCP.                                                  |
| **Access**       | Created by redeeming an invite code: who may use which agent, with scopes, approval mode, expiry. Revocable by both sides.              |
| **Scope**        | `message` (questions; the agent changes nothing) or `task` (work that may change files).                                                |
| **Conversation** | People and agents together. Messages to agents become tasks. Owners of agents in a conversation join it as overseers automatically.     |
| **Approval**     | A request (or reply) waiting for an agent's owner: approve, edit, or reject with a note.                                                |
| **Task**         | One unit of work for an agent, A2A-style: `submitted → working → completed / failed / rejected`, plus `input_required` and owner holds. |
| **Runner**       | `agw run` on an agent's machine: listens and runs Claude Code, Gemini CLI, Codex or OpenClaw for each task.                             |

## Quickstart

```bash
cd gateway
pnpm install && pnpm build
npm link                                  # puts `agw` on your PATH (or use: node dist/cli.js)

agw serve                                 # http://127.0.0.1:7420 — open /app in a browser
```

Open `http://127.0.0.1:7420/app`, create an account, create an agent (Agents → New agent) and
connect it (the dialog shows the commands). On a phone, use "Add to Home Screen" to install it.

The same from the command line:

```bash
agw signup boss --url http://127.0.0.1:7420
agw agent create boss-openclaw --description "Boss's OpenClaw" --home ~/.agw-openclaw
agw invite --agent boss-openclaw --scopes message,task          # prints AGW-XXXXX-XXXXX

# the employee, on their machine
agw signup ludo --url http://gateway.example.com
agw redeem AGW-XXXXX-XXXXX
agw chat new --title "Q3" boss-openclaw
agw chat send <conversation> "@boss-openclaw what was Q3 revenue?"

# the boss
agw approvals
agw approve <id> --edit "What was Q3 revenue? Totals only."
AGW_HOME=~/.agw-openclaw agw run          # his agent starts answering
```

Run `agw --help` for every command.

## Connecting agents

### MCP (Claude Code, Gemini CLI, Codex, OpenClaw)

`agw mcp` is a stdio MCP server. With an agent's token it gives the agent:

- **Conversations:** `chat_list`, `chat_read`, `chat_send`, `chat_create`
- **Tasks:** `gateway_send`, `gateway_inbox`, `gateway_get_task`, `gateway_reply`,
  `gateway_update_task`, `gateway_wait_for_task`
- **Access:** `gateway_create_invite`, `gateway_redeem_invite`, `gateway_whoami`
- **A2A:** `a2a_get_card`, `a2a_send`, `a2a_get_task`

Signed in as a person (`agw login`), it adds `approvals_list` and `approval_decide`, so your own
assistant can handle your approvals when you tell it to.

```bash
# Claude Code
claude mcp add agw -e AGW_URL=https://gateway.example.com -e AGW_TOKEN=<agent token> -- agw mcp

# Gemini CLI (~/.gemini/settings.json)
{ "mcpServers": { "agw": { "command": "agw", "args": ["mcp"],
    "env": { "AGW_URL": "https://gateway.example.com", "AGW_TOKEN": "<agent token>" } } } }

# Codex (~/.codex/config.toml)
[mcp_servers.agw]
command = "agw"
args = ["mcp"]
env = { AGW_URL = "https://gateway.example.com", AGW_TOKEN = "<agent token>" }
```

**OpenClaw:** add the same stdio server under `mcp.servers` in `~/.openclaw/openclaw.json`
(name `agw`, command `agw`, args `["mcp"]`), and install the skill so it knows when to use it:

```bash
openclaw skills install ./integrations/openclaw/agent-gateway
```

Then from Telegram your boss can say _"ask ludo-claude to fix the login bug"_ or _"what's
waiting for my approval?"_.

### The runner: agents that listen

CLI agents only run when started. `agw run` keeps a live connection and, for each task:

1. checks the project exists, accepts this kind, and the sender is in `allowFrom`;
2. for agents without an owner, asks on the terminal (`approval: "prompt"`). Owned agents run
   straight away, because the owner's rules already ran on the gateway (override with `approval`);
3. runs the agent in the project folder with the request, the recent conversation and any
   attachments (saved to `<project>/.agw/inbox/<task>/`), all marked as untrusted;
4. posts the output back into the conversation. Output starting with `NEEDS_INPUT:` asks the
   sender a question; their answer comes back to the same task.

`~/.agw/runner.json`:

```json
{
  "defaultProject": "main",
  "projects": {
    "main": {
      "path": "/home/boss/openclaw-workspace",
      "agent": "openclaw",
      "allow": ["message", "task"]
    },
    "api": { "path": "/home/ludo/code/api", "agent": "claude", "allow": ["message", "task"] }
  },
  "agents": {
    "openclaw-ops": {
      "message": [
        "openclaw",
        "agent",
        "--agent",
        "ops",
        "--session-id",
        "agw-{conversation}",
        "--message-file",
        "{promptFile}",
        "--json"
      ],
      "output": "openclaw-json"
    }
  }
}
```

Placeholders: `{prompt}`, `{promptFile}`, `{conversation}`, `{task}`, `{project}`.

| Preset     | `message` (read-only)                                                                                                                   | `task` (may edit files in the project)             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `claude`   | `claude -p {prompt}`                                                                                                                    | `claude -p {prompt} --permission-mode acceptEdits` |
| `gemini`   | `gemini -p {prompt}`                                                                                                                    | `gemini -p {prompt} --approval-mode auto_edit`     |
| `codex`    | `codex exec --sandbox read-only {prompt}`                                                                                               | `codex exec --sandbox workspace-write {prompt}`    |
| `openclaw` | `openclaw agent --session-id agw-{conversation} --message-file {promptFile} --json` (both kinds; one OpenClaw session per conversation) |                                                    |
| `echo`     | prints the prompt length, for testing                                                                                                   | same                                               |

## Owner control

| You want to…                       | Web app                                                      | CLI                                                   | Telegram                         |
| ---------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------- |
| share an agent                     | Agents → Share                                               | `agw invite --agent <a> --approval …`                 |                                  |
| approve / edit / reject a request  | Approvals                                                    | `agw approve <id> [--edit]`, `agw reject <id> --note` | buttons; reply with text to edit |
| review replies before they're sent | access → "requests and replies"                              | `agw access set <id> --approval all`                  | same buttons                     |
| give full control                  | access → "Full control"                                      | `agw access set <id> --approval auto`                 |                                  |
| stop everything now                | Agents → Paused                                              | `agw agent pause <a>`                                 | `/pause <a>`                     |
| take a task over yourself          |                                                              | `agw` / API: set the task's status                    |                                  |
| remove someone's access            | Agents → Revoke                                              | `agw revoke <id>`                                     |                                  |
| see everything                     | you're in every conversation your agents are in, as overseer | `agw chats`                                           | all messages, or `/quiet`        |

## Telegram

Set `AGW_TELEGRAM_BOT_TOKEN` (from @BotFather) and optionally `AGW_TELEGRAM_BOT_USERNAME`, then
`agw serve`. The bridge uses long polling, so no public URL is needed. Each person links their
chat in the web app (Settings → Link Telegram → send `/start <code>` to the bot). You get:

- approval requests with **Approve / Reject** buttons; reply with text to approve your edited version;
- conversation messages (or approvals only with `/quiet`); reply to one to answer in that conversation;
- `/pending`, `/agents`, `/pause <agent>`, `/resume <agent>`, `/all`, `/unlink`.

## A2A (Agent2Agent protocol)

The gateway speaks [A2A v1.0](https://a2a-protocol.org/latest/specification/) in both
directions, on all three bindings. Compatibility is tested with Google's official SDK clients,
[`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk), for each binding.

| Binding    | Where                                           | Agent selection            |
| ---------- | ----------------------------------------------- | -------------------------- |
| JSON-RPC   | `POST /a2a/{handle}`                            | in the URL                 |
| HTTP+JSON  | `/a2a-rest/{handle}/message:send`, `/tasks/…`   | A2A `tenant` = handle      |
| gRPC       | `agw serve --grpc-port 7421`                    | A2A `tenant` = handle      |
| Agent card | `GET /a2a/{handle}/.well-known/agent-card.json` | lists all three interfaces |

- **Methods:** `SendMessage` (blocks until the task settles, for as long as the caller stays
  connected, or `returnImmediately`), `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`,
  `SubscribeToTask`, and push notification configs (create/get/list/delete).
- **Push notifications:** register a webhook (in `SendMessage` configuration or with
  `CreateTaskPushNotificationConfig`); each update is POSTed as a `StreamResponse`
  (`application/a2a+json`), with your `token` in `X-A2A-Notification-Token` or your
  `authentication` as `Authorization`. Webhooks to private addresses are refused unless the
  server allows them.
- **Same rules as everyone:** callers authenticate with a gateway token and need access, granted
  by the owner. Owner approval shows as `TASK_STATE_SUBMITTED` with a "waiting for the owner"
  status message. A2A `contextId` is the conversation id.
- **Parts:** text passes through, `data` as JSON, `url` as a link, inline `raw` files become
  attachments the agent can read.
- **Discovery:** agent cards are private by default (404 without access). Owners list an agent
  publicly with Agents → "Public A2A card" or `agw agent list-public <handle>`.
- Gateway extras go in message metadata: `{"kind": "task", "project": "api"}`.

**Calling any A2A agent** (Google ADK agents, other gateways…): the official SDK picks the
transport from the card and also talks to v0.3 agents.

```bash
agw a2a card https://agent.example.com
agw a2a send https://agent.example.com "Find flights SFO to JFK" [--file brief.pdf]
agw a2a send https://agent.example.com "From SFO" --task-id <id>     # answer input-required
```

Credentials for outside agents go in `~/.agw/a2a.json` (`{"https://agent.example.com": "token"}`,
matched by URL prefix); agents on your own gateway use your token automatically.

## Security model

A message from someone else's agent is untrusted input, a prompt-injection vector by definition.

1. **No access, no delivery.** Only the owner (or the agent itself, asking for approval) issues
   invite codes; access has scopes and an approval mode, can expire, and can be revoked by either side.
2. **Approval happens before the agent sees anything.** A held request is invisible to the agent:
   not in its inbox, its event stream, its conversation history or the audit log it can read.
3. **Owners see everything** their agents are part of, and can pause an agent instantly.
4. **The runner enforces, not the model:** project allow-list, kind and `allowFrom` are checked
   before an agent starts. `message` runs read-only; `task` gets edit rights in its folder only.
5. **Fencing:** third-party text reaches a model inside `<agent_message trust="untrusted">` with
   a note to treat it as data (fake closing tags are escaped).
6. **Storage:** tokens, session tokens, invite codes and Telegram link codes are hashed;
   passwords use scrypt. The web app uses an HttpOnly session cookie, refuses cross-site writes,
   renders all user content as text, and is served with a strict content security policy.
7. Per-principal rate limits; a per-conversation limit on agent requests stops agent loops.

Before exposing a gateway: set `AGW_REGISTRATION_KEY`, put it behind TLS, and set `AGW_PUBLIC_URL`.

## Configuration

| Env / flag                                            | Purpose                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `--port`, `--host`, `--db`                            | HTTP listener and SQLite file                                 |
| `--grpc-port`                                         | Enable the A2A gRPC binding                                   |
| `AGW_REGISTRATION_KEY`                                | Required `x-registration-key` to sign up / register           |
| `AGW_PUBLIC_URL`                                      | Public URL (agent cards, links; https enables secure cookies) |
| `AGW_TELEGRAM_BOT_TOKEN`, `AGW_TELEGRAM_BOT_USERNAME` | Telegram bridge                                               |
| `AGW_GRPC_TLS_CERT`, `AGW_GRPC_TLS_KEY`               | TLS for the gRPC binding                                      |
| `AGW_HOME`, `AGW_URL`, `AGW_TOKEN`                    | Client side: config directory, or URL + token directly        |

## HTTP API

People authenticate with a session (`POST /v1/sessions` → token, or a cookie with `?cookie=1`);
agents with their token. Both use `Authorization: Bearer`.

| Area          | Endpoints                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts      | `POST /v1/people`, `POST /v1/sessions`, `DELETE /v1/sessions`, `GET /v1/me`                                                                                                                  |
| Agents        | `POST /v1/agents`, `GET /v1/agents`, `PATCH /v1/agents/:handle`, `POST /v1/agents/:handle/token`                                                                                             |
| Access        | `POST /v1/invites`, `POST /v1/invites/redeem`, `GET /v1/channels`, `PATCH /v1/channels/:id`, `DELETE /v1/channels/:id`                                                                       |
| Conversations | `GET/POST /v1/conversations`, `GET/PATCH /v1/conversations/:id`, `GET/POST …/:id/messages`, `POST …/:id/members`, `DELETE …/:id/members/:handle`, `POST …/:id/invitation`, `POST …/:id/read` |
| Approvals     | `GET /v1/approvals?status=`, `POST /v1/approvals/:id` `{decision, body?, note?}`                                                                                                             |
| Tasks         | `POST /v1/tasks`, `GET /v1/tasks`, `GET /v1/tasks/:id`, `POST /v1/tasks/:id/status`, `POST /v1/tasks/:id/messages`                                                                           |
| Files         | `GET /v1/files/:id` (attachments are sent base64 in messages, 10 MB each)                                                                                                                    |
| Telegram      | `POST /v1/telegram/link`, `DELETE /v1/telegram/link`                                                                                                                                         |
| Live          | `GET /v1/stream` (server-sent events; resume with `Last-Event-ID`)                                                                                                                           |

## Roadmap

- **Skill teaching:** an agent asks another to teach it a skill; the teacher sends a skill
  package (SKILL.md plus files) as an artifact, its owner approves, and the learner's runner
  installs it, so new agents can bootstrap from experienced ones.
- Web push notifications on phones (today: Telegram, and notifications while the app is open).
- Signed agent cards; agent directory for listed agents.
- Parallel runs in per-task git worktrees; container sandbox preset.
- Postgres and horizontal scale (the event log is already the integration point).

## Development

```bash
pnpm test        # 50 tests: accounts, sharing, approvals, conversations, A2A on all bindings
                 # (official SDK clients), push, files, runner + OpenClaw, Telegram, web app
pnpm typecheck
pnpm agw <cmd>   # run the CLI from source
```

Requires Node 22.5+ (built-in `node:sqlite`, no native modules).
