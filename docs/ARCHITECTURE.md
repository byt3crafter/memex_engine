# Memex architecture

## Goal

Memex is a kernel that hosts pluggable life-domain modules. Every
module owns its data, schemas, services, routes, MCP tools, and card
payloads. Both the HTTP API and the MCP server are thin adapters
over the same kernel — they iterate `kernel.modules.list()` and
register what each module contributes. Adding a new module is a
folder + an entry in the kernel's modules array; nothing else
changes.

## Component diagram

```text
┌─ Any AI assistant (Claude / OpenClaw / Cursor / Gemini / GPTs) ─┐
│              via MCP (stdio)        or       via REST            │
└──────────────────────────┬───────────────────────────────────────┘
                           │
              ┌────────────┴───────────┐
              │                        │
         apps/mcp                  apps/api
       (MCP server)             (Hono REST API)
              │                        │
              └─────────┬──────────────┘
                        │
                ┌───────▼────────┐
                │ @memex/kernel  │
                │  ─ Module<S>   │
                │  ─ Registry    │
                │  ─ Cards       │
                │  ─ Services:   │
                │     users      │
                │     connections│
                │     pairing    │
                └───────┬────────┘
                        │
        ┌───────────────┼─────────────────┐
        │               │                 │
   @memex/db       @memex/schemas    @memex/modules/<id>
   Drizzle +       Kernel-level      Per-module:
   libSQL +        Zod (User,        manifest, migrations,
   prefixed-cuid2  Connection,       services, routes, MCP
   ids             Card base)        tools, cards, export
```

## Principles

1. **Multi-user from commit #1.** Every domain table has a `user_id`
   FK to `user.id` with `ON DELETE CASCADE`. There is no
   "current user" singleton anywhere; every service takes `userId`
   as the first argument.
2. **Modules own their tables.** Kernel migrations live in
   `packages/db/drizzle/`. Each module ships its own
   migrations folder and the kernel applies them all at boot via
   `applyMigrationsFromFolder`.
3. **One Zod schema, three uses.** Same schema validates HTTP request
   bodies, MCP tool inputs, and supplies TS types.
4. **Cards are runtime-registered.** `@memex/kernel`'s
   `CardSchemaRegistry` collects `CardSchemaContribution`s from each
   module on boot. Renderers (web components, MCP) route by
   `module + type`. Versioned via `cardSchemaVersion: 1`.
5. **Tokens are hashes, not values.** `connection.tokenHash` =
   sha-256 of the bearer; the cleartext is returned exactly once on
   `pair-complete` and never persisted.
6. **Replayable engines.** Recommendation and pattern services
   stamp engine versions onto every persisted output (`reco@v1`)
   so v2 can be A/B-replayed against history.

## The Module<S> contract

```ts
import { defineModule } from '@memex/kernel';

export const myModule = defineModule({
  manifest: {
    id: 'sleep',
    codename: 'Hypnos',
    version: '0.1.0',
    description: '...',
    domain: 'sleep',
    routePrefix: 'sleep',
    dependsOn: ['food'],          // for cross-module reads
    scopes: ['sleep:read', 'sleep:write'],
  },
  migrationsFolder: '...',         // own SQL migrations
  cards: [...],                    // CardSchemaContribution[]
  buildServices: (ctx) => services,// the public S = MyServices
  buildRoutes: (services) => hono, // mounted at /api/v1/<routePrefix>/
  buildMcpTools: (services) => [], // contributed to apps/mcp
  buildExportData: async (s, uid) => ({ /* slice */ }),
});
```

A module's `buildServices` receives a `ModuleContext` with `db`,
`config`, `logger`, and a `KernelHandle`. The handle exposes
`getModuleServices<S>(id)` for cross-module reads — a Behaviour
Governor module asks the kernel for `food` services and reasons over
recent meals.

## Auth model

```
[1] POST /admin/bootstrap                    [bootstrap-token only]
       → creates founder user + first pairing code

[2] POST /api/v1/connections/pair-start      [authed bearer]
       → returns short pairing code + memex:// QR + config snippets

[3] POST /api/v1/connections/pair-complete   [public]
       → exchanges pairing code for long-lived bearer token

[4] Authorization: Bearer mx_<token>         [every authed call]
       → middleware sha-256s, looks up connection,
         resolves user, attaches user + connection to c.var
```

The bootstrap token (`MEMEX_BOOTSTRAP_TOKEN` env) is **only** valid
for `/admin/*`. It cannot double as a regular bearer. Connection
tokens (`mx_…`) cannot reach `/admin/*`.

## Repo layout

```
memex/
├── apps/
│   ├── api/                     # Hono REST server
│   │   └── src/
│   │       ├── server.ts        # composes kernel + module routes
│   │       ├── middleware/      # auth, error, logger
│   │       └── routes/          # /health, /admin, /me, /connections
│   └── mcp/                     # @modelcontextprotocol/sdk over stdio
│       └── src/
│           └── server.ts        # iterates kernel.modules → registers tools
├── packages/
│   ├── kernel/
│   │   ├── module.ts            # Module<S> contract + defineModule()
│   │   ├── registry.ts          # ModuleRegistry
│   │   ├── kernel.ts            # createKernel(modules)
│   │   ├── cards.ts             # CardSchemaRegistry
│   │   ├── services/
│   │   │   ├── user.ts          # createUserService
│   │   │   ├── connection.ts    # createConnectionService
│   │   │   └── pairing.ts       # createPairingService
│   │   └── util/                # clock, normalizeName, sha256, token
│   ├── schemas/
│   │   └── src/                 # User, Connection, PairingCode, Card base
│   ├── db/
│   │   ├── src/schema/          # user, connection, pairing_code, module_registry
│   │   └── drizzle/             # 0000_kernel.sql
│   └── modules/
│       └── food/                # Demeter — first module
│           ├── src/
│           │   ├── schemas/     # Pantry, FoodEvent, Recipe, Menu, ...
│           │   ├── db/schema/   # 7 food tables
│           │   ├── services/    # pantry, food-events, recipes, menus,
│           │   │                # recommendation engine, pattern engine
│           │   ├── routes/      # /api/v1/food/* router
│           │   ├── mcp/         # 11 contributed MCP tools
│           │   └── cards/       # food.* card payload schemas
│           └── drizzle/         # 0000_food.sql
└── docs/
```

## Versioning & change management

- **Database**: kernel migrations under `packages/db/drizzle/`,
  per-module migrations under `packages/modules/<id>/drizzle/`.
  Never edit a committed migration; always add a new one.
- **API**: routes live under `/api/v1/*`. Breaking changes go to
  `/api/v2/*`.
- **Cards**: `cardSchemaVersion` in every payload. Renderers fall
  back gracefully on unknown versions.
- **Engines**: every persisted recommendation row carries its
  `engineVersion` (`reco@v1`); the pattern engine outputs
  versioned `Insight` rows in v0.2 (currently in-memory).

## Deployment

- **Single SQLite file, multi-tenant.** All users share one DB,
  isolated by `user_id` FK. Per-user DB files are a future
  deployment option (no schema changes required).
- **Docker**: `Dockerfile` + `docker-compose.yml` ship the API.
  MCP runs as a host subprocess of the assistant (stdio
  transport), not in Docker.
- **Migrations** are idempotent and run on every container start.

## Non-goals

- Multi-tenant SaaS. Memex is self-hosted, single-deployment,
  multi-user-within-deployment.
- Built-in computer vision. The assistant does extraction; modules
  consume structured items.
- Required UI. The first useful workflow runs entirely through the
  assistant.
