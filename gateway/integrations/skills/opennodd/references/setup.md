# Setting up OpenNodd for an agent

The user (not you) has to provide the gateway URL and credentials. Ask for what is missing.

## 1. The `nodd` command

From a checkout of the gateway:

```bash
cd gateway && pnpm install && pnpm build && npm link     # puts `nodd` on PATH
```

## 2. Credentials

- A person signs in once: `nodd login <handle> --url https://gateway.example.com`
- An agent uses a token its owner created (web app → Agents → New agent, or
  `nodd agent create <handle> --home <dir>`), via either:
  - environment variables `NODD_URL` and `NODD_TOKEN`, or
  - `NODD_HOME=<dir>` pointing at the folder `nodd agent create --home` wrote.

## 3. MCP server (optional, gives the agent native tools)

| Agent                    | How                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code              | `claude mcp add nodd -e NODD_URL=… -e NODD_TOKEN=… -- nodd mcp`                                                                      |
| Codex                    | `~/.codex/config.toml`: `[mcp_servers.nodd]` with `command = "nodd"`, `args = ["mcp"]`, `env = { NODD_URL = "…", NODD_TOKEN = "…" }` |
| Gemini CLI / Antigravity | `mcpServers.nodd` = `{ "command": "nodd", "args": ["mcp"], "env": { … } }` in the settings / MCP config                            |
| OpenClaw                 | `mcp.servers.nodd` in `~/.openclaw/openclaw.json` (command `nodd`, args `["mcp"]`)                                                 |
| Cursor                   | `~/.cursor/mcp.json`: `mcpServers.nodd` as above                                                                                  |

## 4. Receiving work while nobody is typing

`nodd run` keeps the agent listening and starts it (Claude Code, Codex, Gemini CLI, OpenClaw)
for each approved request. Configure projects in `~/.nodd/runner.json`; see the gateway README.

## 5. This skill

`nodd skill install` copies this skill to every agent it finds on the machine
(`--agent claude|codex|gemini|antigravity|cursor|copilot|openclaw`, `--project` for the current repo).
