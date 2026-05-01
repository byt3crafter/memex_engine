# Memex

> Self-hostable, multi-user, AI-native personal-data kernel.
> Pluggable modules share data and connect to any AI assistant.

Memex is the personal-memory machine Vannevar Bush imagined in 1945,
rebuilt for the age of AI assistants. It's a kernel that hosts
domain modules (food, sleep, finance, behaviour, …) which all share
a unified user model and one set of connection tokens. Any AI
assistant — Claude Desktop, OpenClaw, Cursor, Gemini CLI, ChatGPT
GPTs, anything that speaks MCP or HTTP — pairs once and then has
access to whichever modules the user has enabled.

It is not a single-purpose app. It is the substrate for personal
data your AI assistant can reason over.

## Modules

Modules are installable, pluggable life-domain workers. Each ships
under a Greek-deity codename for the thing it governs.

| Module ID  | Codename       | Domain                                         | Status  |
| ---------- | -------------- | ---------------------------------------------- | ------- |
| `food`     | **Demeter**    | Pantry, meals, recipes, menus, recommendations | v0.1.0  |
| `behavior` | **Sophrosyne** | Self-control, habits, behaviour governing      | planned |
| `sleep`    | **Hypnos**     | Sleep tracking, circadian patterns             | planned |
| `health`   | **Hygieia**    | Biometrics, medical history                    | planned |
| `finance`  | **Plutus**     | Money, spending, budgets                       | planned |
| `time`     | **Chronos**    | Calendar, planning, time blocks                | planned |
| `notes`    | **Calliope**   | Journaling, freeform writing                   | planned |

Adding a new module is a folder + an entry in the kernel's modules
array. Zero edits to the kernel, the API server, or the MCP server.

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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full
picture.

## Quickstart

### Local dev

```bash
git clone <repo> memex && cd memex
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install

cp .env.example .env
# At minimum, generate a strong bootstrap token:
# echo "MEMEX_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)" >> .env

pnpm db:migrate
pnpm db:seed                    # 14 days of realistic food data
                                # (prints a pairing code you can use)
pnpm --filter @memex/api dev    # API on http://localhost:8787
```

### Docker

```bash
echo "MEMEX_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)" > .env
docker compose up -d
curl http://localhost:8787/health
```

### Bootstrap your founder user + first pairing code

```bash
TOKEN=<the MEMEX_BOOTSTRAP_TOKEN you set in .env>

curl -X POST http://localhost:8787/admin/bootstrap \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Dovik","timezone":"Indian/Mauritius"}'
# returns founder + pairing.pairingCode + pairing.qrPayload + per-assistant snippets
```

### Pair Claude Desktop / Cursor / OpenClaw

The bootstrap response (or `pnpm db:seed`) prints a pairing code.
Exchange it for a long-lived token (no auth):

```bash
curl -X POST http://localhost:8787/api/v1/connections/pair-complete \
  -H "Content-Type: application/json" \
  -d '{"code":"ABCD-EFGH"}'
# returns { token: "mx_…", connectionId, userId, ... }
```

Drop the token into your assistant's MCP server config:

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/abs/path/memex/apps/mcp/dist/index.js"],
      "env": {
        "MEMEX_DATABASE_URL": "file:/abs/path/memex/data/memex.db",
        "MEMEX_CONNECTION_TOKEN": "mx_..."
      }
    }
  }
}
```

The assistant now has Demeter's tools: `update_pantry`,
`recommend_meal`, `log_actual_meal`, `log_meal_outcome`,
`save_recipe`, `suggest_menu`, `get_recent_patterns`,
`get_weekly_review`, and more. Multiple assistants can pair the
same user — each gets its own token.

See [`docs/ASSISTANT_ONBOARDING.md`](docs/ASSISTANT_ONBOARDING.md)
for full per-assistant instructions.

## Repo layout

```
memex/
├── apps/
│   ├── api/                     # Hono REST server
│   └── mcp/                     # Stdio MCP server
├── packages/
│   ├── kernel/                  # Module<S> contract, registry, kernel services
│   ├── schemas/                 # Kernel-level Zod (User, Connection, Card base)
│   ├── db/                      # Drizzle + libSQL, kernel migrations
│   └── modules/
│       └── food/                # Demeter — first module
└── docs/                        # Architecture, onboarding, spec
```

## Status

`v0.1.0` — first public-shape release. The kernel + module contract
is locked, the food domain is fully ported, multi-user works, MCP
tools work, the pattern engine produces real insights.

`v0.2` will add:

- sqlite-vec + local embeddings (semantic recall in the recommender)
- Astro+Starlight docs site
- The next domain module (likely Hypnos or Sophrosyne)

See [`CHANGELOG.md`](CHANGELOG.md) for the full release notes.

## License

MIT — see [`LICENSE`](LICENSE).
