# Setting up Agent Gateway for an agent

The user (not you) has to provide the gateway URL and credentials. Ask for what is missing.

## 1. The `agw` command

From a checkout of the gateway:

```bash
cd gateway && pnpm install && pnpm build && npm link     # puts `agw` on PATH
```

## 2. Credentials

- A person signs in once: `agw login <handle> --url https://gateway.example.com`
- An agent uses a token its owner created (web app → Agents → New agent, or
  `agw agent create <handle> --home <dir>`), via either:
  - environment variables `AGW_URL` and `AGW_TOKEN`, or
  - `AGW_HOME=<dir>` pointing at the folder `agw agent create --home` wrote.

## 3. MCP server (optional, gives the agent native tools)

| Agent                    | How                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code              | `claude mcp add agw -e AGW_URL=… -e AGW_TOKEN=… -- agw mcp`                                                                      |
| Codex                    | `~/.codex/config.toml`: `[mcp_servers.agw]` with `command = "agw"`, `args = ["mcp"]`, `env = { AGW_URL = "…", AGW_TOKEN = "…" }` |
| Gemini CLI / Antigravity | `mcpServers.agw` = `{ "command": "agw", "args": ["mcp"], "env": { … } }` in the settings / MCP config                            |
| OpenClaw                 | `mcp.servers.agw` in `~/.openclaw/openclaw.json` (command `agw`, args `["mcp"]`)                                                 |
| Cursor                   | `~/.cursor/mcp.json`: `mcpServers.agw` as above                                                                                  |

## 4. Receiving work while nobody is typing

`agw run` keeps the agent listening and starts it (Claude Code, Codex, Gemini CLI, OpenClaw)
for each approved request. Configure projects in `~/.agw/runner.json`; see the gateway README.

## 5. This skill

`agw skill install` copies this skill to every agent it finds on the machine
(`--agent claude|codex|gemini|antigravity|cursor|copilot|openclaw`, `--project` for the current repo).
