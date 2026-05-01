# PantryMind

> AI-native, self-hostable food and health memory for your assistant.
> Pantry-aware. Reality-first. Outcome-learning.

PantryMind is a backend that turns any AI assistant (Claude, OpenClaw,
ChatGPT, Cursor, anything that speaks MCP or HTTP) into a useful personal
food and health companion. It records what food you actually have, what you
actually eat, and how you actually feel afterwards — then surfaces patterns
and turns successful real meals into reusable recipes over time.

It is **not** a diet app. It does not lecture, count calories at you, or
hand you rigid meal plans. It captures reality with minimal friction, and
the more you use it the more useful it becomes.

## What makes it different

- **Reality-first capture.** Logs what actually happened, not what was
  planned.
- **Outcome → pattern loop.** Every meal links to satisfaction / energy /
  hunger after. The system surfaces personal patterns.
- **Pantry-constrained recommendations.** It only suggests meals using food
  that's actually available.
- **Explicit recipe promotion.** Recipes are crystallized from successful
  real meals, not pre-loaded.
- **Assistant-first, MCP-native.** Every capability is a tool any assistant
  can call. No app to open.
- **Self-hosted, local-first, exportable.** SQLite on disk. Local
  embeddings. Cloud LLM is optional, never required.

## Architecture at a glance

```
Any AI assistant ──► MCP server  ─┐
                                  ├─► packages/core (services) ─► SQLite + sqlite-vec
Web / curl / scripts ► REST API  ─┘
```

The HTTP API and the MCP server are two adapters in front of one shared
domain layer. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Quickstart

```bash
# 1. clone & enter
git clone <this-repo> pantrymind && cd pantrymind

# 2. node 22 + pnpm via corepack
corepack enable && corepack prepare pnpm@latest --activate
pnpm install

# 3. configure
cp .env.example .env
# edit .env: at minimum set HEALTHLOOP_API_TOKEN

# 4. database
pnpm db:migrate
pnpm db:seed        # optional: 14-day demo data

# 5. run
pnpm dev            # api + mcp via Turbo

# 6. verify
pnpm demo:dry-run   # walks the whole loop end-to-end, no UI required
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/health
```

## Connect your AI assistant

See [`docs/ASSISTANT_ONBOARDING.md`](docs/ASSISTANT_ONBOARDING.md) for the
copyable system prompt and example MCP client configs (Claude Desktop,
OpenClaw, Cursor, generic MCP).

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — full product specification.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, stack, and
  rationale.
- [`docs/ASSISTANT_ONBOARDING.md`](docs/ASSISTANT_ONBOARDING.md) —
  connecting any assistant to PantryMind.
- [`CHANGELOG.md`](CHANGELOG.md) — phase-by-phase build log.

## Status

Pre-release. See `CHANGELOG.md` for current phase.

## License

MIT — see [`LICENSE`](LICENSE).
