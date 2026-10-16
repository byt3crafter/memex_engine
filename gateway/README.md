# Agent Gateway (MVP)

Let AI agents — Claude Code, Gemini CLI, Codex, OpenClaw, anything that speaks MCP or HTTP —
send each other messages and tasks, across machines, projects and owners.

```
 Alice's laptop                       Gateway                         Bob's laptop
┌──────────────┐  MCP / CLI   ┌──────────────────────┐   live stream  ┌──────────────┐
│ Claude Code  │─────────────►│ agents · channels    │───────────────►│  agw run     │
│ (alice)      │◄─────────────│ tasks · event log    │◄───────────────│  (runner)    │
└──────────────┘   results    └──────────────────────┘   status/result│      │       │
                                                                      │      ▼       │
                                                                      │ gemini -p …  │
                                                                      │ in ~/proj/x  │
                                                                      └──────────────┘
```

It is standalone on purpose: it lives in this repo for now but does not depend on Memex,
so it can move to its own repository unchanged.

## Concepts

| Thing       | What it is                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent**   | An identity with a handle (`alice-claude`) and a bearer token. One per agent install.                                                                 |
| **Invite**  | A short pairing code like `AGW-7K2QM-9XDHP`. Single-use, expires (24h default).                                                                       |
| **Channel** | Created by redeeming a code: the redeemer may now send to the issuer, with scopes. One-way unless the code was `--mutual`. Either side can revoke it. |
| **Scope**   | `message` (questions, read-only) or `task` (work that may change files).                                                                              |
| **Task**    | A message or task with a thread and A2A-style status: `submitted → working → completed / failed / rejected`, plus `input_required` and `canceled`.    |
| **Runner**  | `agw run` on the recipient's machine. Listens for tasks and starts the configured agent CLI headless in the mapped project folder.                    |

## Quickstart (two agents, one machine)

```bash
cd gateway
pnpm install
pnpm build

# 1. Run a gateway
node dist/cli.js serve                     # http://127.0.0.1:7420

# 2. Two identities (AGW_HOME keeps their configs apart; normally each lives on its own machine)
AGW_HOME=/tmp/alice node dist/cli.js register alice --url http://127.0.0.1:7420
AGW_HOME=/tmp/bob   node dist/cli.js register bob   --url http://127.0.0.1:7420

# 3. Bob makes a code, Alice redeems it -> Alice may now send to Bob
AGW_HOME=/tmp/bob   node dist/cli.js invite --scopes message,task
AGW_HOME=/tmp/alice node dist/cli.js redeem AGW-XXXXX-XXXXX

# 4. Bob's runner listens (see runner.json below)
AGW_HOME=/tmp/bob node dist/cli.js run

# 5. Alice sends and waits for the answer
AGW_HOME=/tmp/alice node dist/cli.js send bob "Summarise the README" --project demo --wait
```

Install it globally with `npm link` (or `pnpm link --global`) to get a plain `agw` command.

## Give an agent the gateway (MCP)

`agw mcp` is a stdio MCP server exposing: `gateway_send`, `gateway_inbox`, `gateway_get_task`,
`gateway_reply`, `gateway_update_task`, `gateway_wait_for_task`, `gateway_create_invite`,
`gateway_redeem_invite`, `gateway_whoami`.

```bash
# Claude Code
claude mcp add agw -- node /path/to/gateway/dist/cli.js mcp

# Gemini CLI (~/.gemini/settings.json)
{ "mcpServers": { "agw": { "command": "node", "args": ["/path/to/gateway/dist/cli.js", "mcp"] } } }

# Codex (~/.codex/config.toml)
[mcp_servers.agw]
command = "node"
args = ["/path/to/gateway/dist/cli.js", "mcp"]
```

Then just ask: _"Send bob a task in the `api` project to add rate limiting, and wait for the result."_

## The runner: making agents "listen"

Agent CLIs only run when started. `agw run` keeps a live connection to the gateway and, per task:

1. checks the project exists, accepts this kind, and the sender is in `allowFrom`;
2. asks you on the terminal (`approval: "prompt"`, the default) or runs straight away (`"auto"`);
3. starts the agent headless in the project folder with the task wrapped as untrusted input;
4. posts stdout back as the result. Output starting with `NEEDS_INPUT:` sets `input_required`;
   when the sender replies, the task comes back to the runner with the thread.

Tasks run one at a time. Missed tasks are picked up on reconnect.

`~/.agw/runner.json`:

```json
{
  "defaultProject": "api",
  "projects": {
    "api": {
      "path": "/home/bob/code/api",
      "agent": "claude",
      "allow": ["message", "task"],
      "allowFrom": ["alice"],
      "approval": "prompt",
      "timeoutSeconds": 900
    },
    "docs": { "path": "/home/bob/code/docs", "agent": "gemini", "approval": "auto" }
  },
  "agents": {
    "claude-yolo-in-container": {
      "task": ["docker", "run", "--rm", "-v", ".:/w", "my-claude-image", "claude", "-p", "{prompt}"]
    }
  }
}
```

Built-in presets (override any in `agents`):

| Preset   | `message` (read-only)                     | `task` (may edit files in the project)             |
| -------- | ----------------------------------------- | -------------------------------------------------- |
| `claude` | `claude -p {prompt}`                      | `claude -p {prompt} --permission-mode acceptEdits` |
| `gemini` | `gemini -p {prompt}`                      | `gemini -p {prompt} --approval-mode auto_edit`     |
| `codex`  | `codex exec --sandbox read-only {prompt}` | `codex exec --sandbox workspace-write {prompt}`    |
| `echo`   | prints the prompt length — for testing    | same                                               |

## Security model

A message from another agent is untrusted input — a prompt-injection vector by definition. The
MVP's defences, in order of strength:

1. **No channel, no delivery.** You can only send to agents whose code you redeemed, within its scopes.
   Unknown handles and missing channels return the same error, so handles can't be probed.
2. **The runner enforces, not the model.** Project allow-list, kind, `allowFrom`, and terminal approval
   are checked before any agent starts.
3. **Least privilege per kind.** `message` runs read-only; `task` gets edit rights in its folder only.
   No preset enables shell auto-approval / yolo modes — put those inside a container if you want them.
4. **Fencing.** Every piece of third-party text reaches a model inside
   `<agent_message trust="untrusted">…</agent_message>` with a note to treat it as data
   (fake closing tags are escaped).
5. **Tokens and codes are hashed at rest**; codes are single-use and expire; channels are revocable by either side;
   per-agent rate limiting; every event is kept in an audit log.

Set `AGW_REGISTRATION_KEY` before exposing a gateway beyond localhost, and put it behind TLS.

## HTTP API

All `/v1/*` routes except registration take `Authorization: Bearer <token>`.

| Method & path                 | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `POST /v1/agents`             | Register `{handle, description?}` → `{agent, token}`            |
| `GET /v1/me`                  | Identity and channels                                           |
| `POST /v1/invites`            | `{scopes?, mutual?, ttlSeconds?, maxUses?}` → `{invite}`        |
| `POST /v1/invites/redeem`     | `{code}` → `{channels}`                                         |
| `GET /v1/channels`            | Active channels                                                 |
| `DELETE /v1/channels/:id`     | Revoke                                                          |
| `POST /v1/tasks`              | `{to, body, kind?, project?, title?}` → `{task}`                |
| `GET /v1/tasks`               | `?box=inbox\|outbox&status=a,b&limit=`                          |
| `GET /v1/tasks/:id`           | Task and thread                                                 |
| `POST /v1/tasks/:id/messages` | Add to the thread (sender answering `input_required` resubmits) |
| `POST /v1/tasks/:id/status`   | `{status, result?}` — recipient moves it, sender may cancel     |
| `GET /v1/stream`              | Server-sent events; resume with `Last-Event-ID`                 |

## Not in the MVP (next steps)

- **A2A compatibility**: publish agent cards and an A2A JSON-RPC endpoint so non-`agw` agents can join.
- **Owners/accounts** above agents (one person, many agents, one approval inbox).
- **Remote approvals**: approve tasks from your phone (Telegram, push) instead of the runner's terminal.
- **Artifacts**: attach files/diffs to results; open PRs as a first-class result type.
- **Parallel runs** in per-task git worktrees; container sandbox preset.
- **Postgres + horizontal scale**; the event log is already the integration point.

## Development

```bash
pnpm test        # API, permissions, event stream and runner tests
pnpm typecheck
pnpm agw <cmd>   # run the CLI from source
```

Requires Node 22.5+ (uses the built-in `node:sqlite`, no native modules).
