# Memex

> Self-hostable, multi-user, AI-native personal-data kernel.
> Pluggable modules share data and connect to any AI assistant.

Memex is the personal-memory machine Vannevar Bush imagined in 1945,
rebuilt for the age of AI assistants. It's a kernel that hosts
domain modules (food, sleep, finance, behaviour, ...) which all share
a unified user model and one set of connection tokens. Any AI
assistant — Claude Desktop, OpenClaw, Cursor, Gemini CLI, ChatGPT
GPTs, anything that speaks MCP or HTTP — pairs with Memex once and
then has access to whichever modules the user has enabled.

It is not a single-purpose app. It is the substrate for personal data
your AI assistant can reason over.

## Modules

Modules are installable, pluggable life-domain workers. Each one ships
under a Greek-deity codename that names what it governs.

| Module ID  | Codename       | Domain                                         | Status  |
| ---------- | -------------- | ---------------------------------------------- | ------- |
| `food`     | **Demeter**    | Pantry, meals, recipes, menus, recommendations | Phase 2 |
| `behavior` | **Sophrosyne** | Self-control, habits, behaviour governing      | Future  |
| `sleep`    | **Hypnos**     | Sleep tracking, circadian patterns             | Future  |
| `health`   | **Hygieia**    | Biometrics, medical history                    | Future  |
| `finance`  | **Plutus**     | Money, spending, budgets                       | Future  |
| `time`     | **Chronos**    | Calendar, planning, time blocks                | Future  |
| `notes`    | **Calliope**   | Journaling, freeform writing                   | Future  |

A new module = drop a folder under `packages/modules/<id>/`, add it to
the kernel's module registry, done. No edits to the kernel, the API
server, or the MCP server.

## Architecture at a glance

```
Any AI assistant ──► MCP server ─┐
                                 ├─► Kernel ─► Module registry
HTTP / curl / scripts ► REST API ┘                  │
                                                    ├─ Demeter (food)
                                                    ├─ Hypnos (sleep)
                                                    └─ ...
```

Both the HTTP API and the MCP server are thin adapters over the
kernel. The kernel composes registered modules into one runtime,
applies their migrations, and exposes per-user services. Bearer-token
auth resolves a connection → a user → a per-user view of every
enabled module.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.

## Connection mechanism

Memex doesn't make you copy/paste long tokens. To connect an
assistant:

1. From the website (or via the admin token), you start a pairing:
   `POST /api/v1/connections/pair-start`.
2. Memex returns a short pairing code, a `memex://pair?code=…&host=…`
   QR-encodable deep link, and ready-to-paste config snippets for
   Claude Desktop, OpenClaw, Cursor, Gemini CLI, and bare HTTP.
3. The assistant either scans the QR / pastes the snippet (MCP
   stdio), or calls `POST /api/v1/connections/pair-complete` to
   exchange the code for a long-lived token (HTTP / MCP-SSE).
4. The token identifies the user. Revoke any time.

See [`docs/ASSISTANT_ONBOARDING.md`](docs/ASSISTANT_ONBOARDING.md).

## Quickstart

```bash
git clone <repo> memex && cd memex
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
cp .env.example .env
# at minimum, set MEMEX_BOOTSTRAP_TOKEN

pnpm db:migrate
pnpm dev                      # api + mcp via Turbo
pnpm demo:dry-run             # full assistant-native loop, no UI
```

## Status

Pre-release. Memex is being rebuilt from a single-user prototype
(`archive/v0-pantrymind-prototype` branch holds 18 commits' worth of
food-domain reasoning that informs the new design) into a real
multi-user kernel. See [`CHANGELOG.md`](CHANGELOG.md) for the current
phase.

## License

MIT — see [`LICENSE`](LICENSE).
