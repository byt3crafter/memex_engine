# Connecting an AI assistant to Memex

Memex pairs with any assistant that speaks MCP (stdio) or HTTP. The
flow is the same for all of them: get a pairing code, exchange it
for a long-lived token, paste the token into the assistant's
config.

## Step 1 — bootstrap your founder user (once per deployment)

Generate a bootstrap token, set it in `.env`, and create the
founder user.

```bash
echo "MEMEX_BOOTSTRAP_TOKEN=$(openssl rand -hex 32)" > .env
pnpm db:migrate
pnpm --filter @memex/api dev    # or `docker compose up -d`

TOKEN=$(grep MEMEX_BOOTSTRAP_TOKEN .env | cut -d= -f2)
curl -X POST http://localhost:8787/admin/bootstrap \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Your Name","timezone":"Indian/Mauritius"}'
```

The response includes:

- `founder.id` — your user id
- `pairing.pairingCode` — 8-char code, one-time-use
- `pairing.qrPayload` — `memex://pair?code=...&host=...`
- `pairing.configSnippets` — pre-baked configs for common assistants

## Step 2 — exchange the pairing code for a token

The pair-complete endpoint is **public** (no auth). The pairing
code is the proof.

```bash
curl -X POST http://localhost:8787/api/v1/connections/pair-complete \
  -H "Content-Type: application/json" \
  -d '{"code":"ABCD-EFGH"}'
```

Response:

```json
{
  "connectionId": "con_...",
  "token": "mx_...",
  "userId": "usr_...",
  "scopes": [],
  "baseUrl": "http://localhost:8787"
}
```

Save the `token`. It is shown only once. If you lose it, start
another pairing.

## Step 3 — wire it into your assistant

### Claude Desktop / OpenClaw / Cursor (MCP stdio)

`~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS, equivalent on Linux/Windows. OpenClaw and Cursor have
near-identical MCP config formats.

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/abs/path/to/memex/apps/mcp/dist/index.js"],
      "env": {
        "MEMEX_DATABASE_URL": "file:/abs/path/to/memex/data/memex.db",
        "MEMEX_CONNECTION_TOKEN": "mx_...",
        "MEMEX_BOOTSTRAP_TOKEN": "<same as in your .env>"
      }
    }
  }
}
```

For dev mode, point at `tsx`:

```json
{
  "mcpServers": {
    "memex": {
      "command": "pnpm",
      "args": ["--filter", "@memex/mcp", "exec", "tsx", "src/index.ts"],
      "cwd": "/abs/path/to/memex",
      "env": {
        "MEMEX_DATABASE_URL": "file:/abs/path/to/memex/data/memex.db",
        "MEMEX_CONNECTION_TOKEN": "mx_...",
        "MEMEX_BOOTSTRAP_TOKEN": "<same as in your .env>"
      }
    }
  }
}
```

Restart your assistant. It should now list 11 Memex tools:
`memex_whoami`, `update_pantry`, `list_available_food`,
`recommend_meal`, `log_food_event`, `log_actual_meal`,
`log_meal_outcome`, `save_recipe`, `list_recipes`, `suggest_menu`,
`get_recent_patterns`, `get_weekly_review`.

### HTTP / curl / scripts / Gemini CLI / custom GPTs

Use the bearer token directly:

```bash
curl http://localhost:8787/api/v1/me \
  -H "Authorization: Bearer mx_..."
```

The full REST surface lives under `/api/v1/food/*` (Demeter). See
the route file at `packages/modules/food/src/routes/index.ts` for
the canonical list.

## Step 4 — give the assistant a system prompt

Paste this into the assistant's personality / custom instruction:

> You are connected to my personal Memex backend. The food module
> ("Demeter") is enabled. When I mention food, meals, cravings,
> groceries, or what I ate, use the Memex tools to capture
> structured data. Every food interaction should record ingredients,
> protein source, rough portion, recommendation, actual meal, and
> outcome. Do not save every meal as a recipe — only when I ask, or
> when you suggest it and I approve. When I ask what to eat, call
> `recommend_meal` first. After I eat, call `log_actual_meal` and
> follow up with `log_meal_outcome`. Reflect weekly via
> `get_weekly_review`. Prefer low-friction advice over rigid plans.

## Multiple assistants, one user

Your founder user can have many connections. Pair Claude Desktop,
OpenClaw, and Cursor all to the same user — each gets its own
`mx_…` token, all see the same data.

```bash
# As an authed user (using a connection token, not the bootstrap one):
curl -X POST http://localhost:8787/api/v1/connections/pair-start \
  -H "Authorization: Bearer mx_..." \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Cursor","clientKind":"mcp_stdio","scopes":[]}'
# returns a fresh pairing code → exchange via pair-complete
```

List your connections:

```bash
curl http://localhost:8787/api/v1/connections \
  -H "Authorization: Bearer mx_..."
```

Revoke any (kills future requests with that token):

```bash
curl -X DELETE http://localhost:8787/api/v1/connections/con_xxx \
  -H "Authorization: Bearer mx_..."
```

## Multiple users on one Memex

Bootstrap is one-shot — it creates the founder. To add more users,
the founder calls the user-creation API directly (or, in v0.2, via
a user-invite flow yet to be built):

```bash
# As founder:
# (kernel.userService.create is exposed via the API in v0.2.
#  For v0.1, create users programmatically via the kernel.)
```

Each user has fully isolated data: tables foreign-key onto
`user.id` with `ON DELETE CASCADE`, and every food service requires
a `userId` parameter that the auth middleware sets from the
resolved connection.

## Troubleshooting

- **"invalid or revoked token"** — the token doesn't exist in
  `connection` or has `revoked_at != null`. Pair again.
- **"MEMEX_CONNECTION_TOKEN is required"** — the MCP process didn't
  receive the token. Check your assistant's MCP config `env`.
- **"invalid bootstrap token"** — `MEMEX_BOOTSTRAP_TOKEN` env in
  the running API process doesn't match the token you sent. Both
  must be the same.
- **MCP tools not showing up** — restart your assistant after
  editing its config; many assistants only read MCP config at
  startup.

## Privacy

- Tokens are stored sha-256-hashed; the cleartext is returned
  exactly once and never persisted.
- All food / health / personal data lives in your local SQLite file
  under `data/memex.db`. Memex never phones home.
- The recommendation engine is pure deterministic code. No cloud
  LLM is called by Memex itself; your assistant is the LLM.
- v0.2 will add local embeddings via `@xenova/transformers` (also
  cloud-free) for semantic recall.
