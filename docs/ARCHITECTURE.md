# Architecture

## Goal

PantryMind is one domain core wrapped in two parallel adapters — a
REST API and an MCP server. Both adapters call the same services. Both
return the same shape of data. This is non-negotiable: domain logic
lives in exactly one place.

## High-level diagram

```text
┌─ Any AI assistant (Claude, OpenClaw, ChatGPT, Cursor) ─┐
│            via MCP   or   via REST                      │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴───────────┐
              │                        │
         apps/mcp                  apps/api
       (MCP server)             (Hono REST API)
              │                        │
              └─────────┬──────────────┘
                        │
                ┌───────▼────────┐
                │ packages/core  │
                │  • profile     │
                │  • pantry      │
                │  • food-event  │
                │  • recipe      │
                │  • menu        │
                │  • reco engine │
                │  • pattern     │
                │  • card-builder│
                └───────┬────────┘
                        │
        ┌───────────────┼─────────────────┐
        │               │                 │
   packages/db    packages/schemas   packages/cards
   (Drizzle +     (Zod, shared)      (card JSON types)
    libSQL +
    sqlite-vec)
```

## Principles

1. **Core knows nothing about HTTP or MCP.** Services accept typed
   inputs, return typed outputs. Adapters serialize.
2. **One Zod schema, three uses.** Same schema validates HTTP request
   bodies, MCP tool inputs, and generates OpenAPI. One source of truth.
3. **Event-sourced food log.** `food_event` rows are append-only.
   Recipes, menus, and patterns are _projections_ — recomputable when
   the recommendation engine improves.
4. **Cards are first-class output.** Every domain action returns both
   raw data and a renderable `card` JSON blob. Card schema is versioned
   (`cardSchemaVersion`) and never broken silently.
5. **Local-first.** SQLite on disk. Local embeddings via
   `@xenova/transformers`. Cloud LLM is optional, never required.
6. **Replayable recommendation traces.** Every `recommendation` stores
   its full input snapshot, the engine version that produced it, the
   reasoning, the selected option, and (eventually) its outcome. We can
   measure recommendation quality over time and A/B against history.

## Stack

| Layer      | Pick                           | Rationale                                                                           |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Runtime    | Node.js 22 + TypeScript strict | LTS-track, mature, good tooling.                                                    |
| HTTP       | Hono                           | Lighter than Fastify, runs on Node/Bun/Workers, built-in `app.request()` for tests. |
| Validation | Zod 3                          | Single schema → REST + MCP + OpenAPI + TS types.                                    |
| DB         | libSQL (SQLite fork)           | Self-hostable, embeddable, optional remote replication.                             |
| ORM        | Drizzle ORM                    | Typed queries, no runtime overhead, painless migrations.                            |
| Vector     | sqlite-vec extension           | Local embeddings stored alongside data; no separate vector DB.                      |
| Embeddings | `@xenova/transformers`         | Local sentence-transformers; no cloud calls required.                               |
| MCP        | `@modelcontextprotocol/sdk`    | Official TS SDK; tools / resources / prompts.                                       |
| Tests      | Vitest                         | ESM-native, fast, watch mode.                                                       |
| Logger     | Pino                           | Structured JSON, fast, ergonomic.                                                   |
| Monorepo   | pnpm workspaces + Turborepo    | Workspaces for code, Turbo for cached builds.                                       |
| API docs   | `@hono/zod-openapi`            | OpenAPI generated from the same Zod schemas as the routes.                          |
| Docs site  | Astro + Starlight              | Static, fast, content-first.                                                        |
| Cards lib  | Lit (post-MVP)                 | Web Components, framework-agnostic, ~30KB bundle.                                   |
| PWA shell  | SvelteKit (post-MVP)           | Smallest output, simplest model, plays well with Lit.                               |

## Repository layout

```text
pantrymind/
├── apps/
│   ├── api/          # Hono REST server
│   ├── mcp/          # MCP server (stdio transport)
│   └── docs/         # Astro + Starlight docs site (Phase 5)
├── packages/
│   ├── schemas/      # Zod models, shared types
│   ├── db/           # Drizzle schema, migrations, libSQL client
│   ├── core/         # Domain services (the only place logic lives)
│   ├── cards/        # Card JSON types + builder helpers
│   └── cards-web/    # Lit Web Components (post-MVP)
├── docs/             # Project documentation (this file lives here)
└── scripts/          # One-shot operational scripts
```

## Domain services (`packages/core`)

Each service is a small module owning one entity family.

- `profileService` — read / update the single user profile row.
- `pantryService` — CRUD pantry items, bulk-update, query by category /
  availability.
- `foodEventService` — append food events, attach items, log outcomes.
- `recommendationService` — produces 1–3 candidate meals from
  craving + pantry + history + recipes + outcomes. Versioned engine
  field on every recommendation so we can swap implementations without
  losing history.
- `recipeService` — promote a food_event into a recipe; recipe CRUD;
  ingredient and tag search.
- `menuService` — produce a menu plan from recipes + pantry, compute
  shopping gaps.
- `patternService` — compute insights from outcomes (Phase 4).
- `cardBuilder` — turn domain entities into renderable card JSON.

Services accept a `db` handle (created by `packages/db`'s `createDb`)
plus typed input. They return typed output. They do not touch HTTP, MCP,
or `process.env`.

## Adapters

### `apps/api`

Hono server. One file per route group under `src/routes/`. Routes use
`@hono/zod-openapi` to register schemas. Bearer token auth middleware
reads `HEALTHLOOP_API_TOKEN`. Pino logger emits structured JSON with
request IDs. Errors return `{error, code, details}` shapes.

### `apps/mcp`

`@modelcontextprotocol/sdk` server over stdio. Tools, resources, and
prompts each defined in `src/tools/*.ts`, `src/resources/*.ts`,
`src/prompts/*.ts`. Each tool reuses the same Zod schemas as the
matching REST route (single source of truth) and calls the same core
service. No business logic lives in the MCP layer.

## Configuration

All configuration is read from environment variables, validated with
Zod at startup. See `.env.example` for the full list. The config loader
lives in `packages/core/src/config.ts` and is shared by both apps.

## Versioning & change management

- **Database**: Drizzle migrations under `packages/db/drizzle/`. Never
  edit a committed migration; always add a new one.
- **API**: routes live under `/api/v1/*`. Breaking changes go to
  `/api/v2/*`.
- **Cards**: `cardSchemaVersion` in every card payload. Renderers must
  fall back gracefully on unknown versions.
- **Recommendation engine**: every recommendation row stores the engine
  version (`reco@v1`, `reco@v2`, …) that produced it.

## Deferred / future

- Photo / receipt ingestion (schema fields exist, endpoint deferred).
- Exercise + measurements API surface (schema exists, endpoints
  deferred).
- Web Component card library (`packages/cards-web`, Phase 6).
- PWA shell (`apps/pwa`, Phase 7).
- Native shells via Tauri (desktop) and Capacitor (mobile) — only if
  PWA proves insufficient.

## Non-goals

- Multi-tenant SaaS. Single user, self-hosted.
- Built-in computer vision. The assistant does extraction; the backend
  consumes structured items.
- Calorie-counting prison. Calories are optional, confidence-scored, and
  never block logging.
- A required UI. The first useful workflow runs entirely through the
  assistant.
