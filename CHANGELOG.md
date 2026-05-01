# Changelog

All notable changes to Memex are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-01

First public-shape release. The PantryMind v0 prototype (preserved on
`archive/v0-pantrymind-prototype` — 18 commits, single-user, full
food-loop demo) was the design study. Memex is the real product:
multi-user from day one, kernel + module plugin contract, real
connection/pairing flow for arbitrary AI assistants, deterministic
pattern engine. The food domain is now the **Demeter** module — the
first proof of the Module<S> contract.

### Architecture

- **Kernel + Module plugin contract.** Every domain — food, behavior
  (Sophrosyne), sleep (Hypnos), … — is a `Module<S>` declaring
  manifest, migrations, card schemas, services, routes, MCP tools,
  and an export hook. Adding a module = drop a folder, add it to the
  kernel's `modules` array. No edits to the kernel, the API server,
  or the MCP server.
- **Multi-user.** `user`, `connection`, `pairing_code` tables in the
  kernel. Every food table foreign-keys onto `user.id` with cascade
  delete. Two users have isolated pantries — verified by test.
- **Connection mechanism.** Bearer tokens stored sha-256-hashed.
  Founder bootstrap creates the first user and a pairing code
  through `MEMEX_BOOTSTRAP_TOKEN`. Subsequent connections via
  `POST /api/v1/connections/pair-start` (returns code + QR payload +
  ready-to-paste config snippets) and
  `POST /api/v1/connections/pair-complete` (no auth, exchanges code
  for token).
- **Card registry.** Modules contribute Zod-validated card payload
  schemas to a runtime registry; renderers route by `module` +
  `type`. Versioned (`cardSchemaVersion: 1`).

### Phase 0 — workspace + kernel scaffolding

- pnpm workspace: `apps/*`, `packages/*`, `packages/modules/*`.
- Turborepo, strict TS (`verbatimModuleSyntax`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
  Prettier.
- `@memex/schemas`: kernel Zod (User, Connection, PairingCode,
  base Card, Module manifest).
- `@memex/db`: drizzle-orm + libSQL, kernel migration
  `0000_kernel.sql`, `applyKernelMigrations` +
  `applyMigrationsFromFolder`, prefixed-cuid2 ids.
- `@memex/kernel`: `Module<S>` interface, `ModuleRegistry`,
  `CardSchemaRegistry`, `createKernel(modules)` orchestrator,
  cross-module `KernelHandle.getModuleServices<S>(id)`.
- `@memex/kernel/util`: clock, normalizeName, sha-256 token hashing.

### Phase 1 — multi-user, auth, pairing

- `userService`, `connectionService`, `pairingService` on the
  kernel.
- Bearer auth middleware resolves token → connection → user;
  bootstrap-token middleware guards `/admin/*`.
- `apps/api` with `/health`, `/admin/bootstrap`,
  `/api/v1/connections/pair-start|pair-complete`,
  `/api/v1/connections`, `/api/v1/me`.
- 8-char `ABCD-EFGH` pairing codes from a confusable-free
  alphabet. `memex://pair?code=…&host=…` QR payload + Claude
  Desktop / curl / generic config snippets.

### Phase 2 — module-food (Demeter v0.1.0)

- All food services userId-scoped (no singleton fallback): pantry,
  food-events + items + outcomes, recipes (full CRUD + soft delete +
  promote-from-food-event), menus (pantry-overlap planner with
  shopping gaps), recommendations.
- Recommendation engine v1 (`reco@v1`): pure deterministic scoring
  over context (pantry, recipes, recent meals + outcomes,
  craving / preferred protein) with freestyle bowl/plate/sandwich
  fallbacks. Engine version stamped on every persisted row for
  replayability.
- Food card payloads: `food.meal_recommendation`, `food.menu`.
- Routes mount automatically at `/api/v1/food/*` via the kernel's
  module-iteration in `apps/api/src/server.ts`.
- Module owns its migrations folder (`0000_food.sql` — 7 tables).

### Phase 3 — MCP server with module-shaped tool registration

- `apps/mcp`: stdio MCP server. `createMcpServer(kernel, auth)`
  iterates `kernel.modules.list()` and registers each module's
  contributed tools via the `@modelcontextprotocol/sdk`.
- Built-in `memex_whoami` tool returns the resolved user +
  connection + module list.
- Demeter contributes 11 tools: `update_pantry`,
  `list_available_food`, `recommend_meal`, `log_food_event`,
  `log_actual_meal`, `log_meal_outcome`, `save_recipe`,
  `list_recipes`, `suggest_menu`, `get_recent_patterns`,
  `get_weekly_review`.
- Auth resolves once at startup from `MEMEX_CONNECTION_TOKEN`;
  tools never see the bearer.
- Tested via `InMemoryTransport.createLinkedPair()` driving the
  full assistant loop end-to-end without spawning a subprocess.

### Phase 4 — pattern engine (deterministic insights)

- `patternService.recentInsights(userId, days)` produces six
  evidence-bearing insight kinds without ML:
  - `protein_energy_correlation`
  - `unpromoted_recipe_candidates`
  - `variety_drop`
  - `top_satisfying_meals`
  - `craving_outcomes`
  - `activity_dropoff`
- `patternService.weeklyReview(userId)` composes a one-week
  summary + insights + recipe candidates.
- Card payloads: `food.insight`, `food.weekly_review`.
- MCP `get_recent_patterns` and `get_weekly_review` wired to real
  data.

#### Deferred to v0.2

- **sqlite-vec + local embeddings** (`@xenova/transformers`):
  semantic recall in recommendation engine v2, fuzzy recipe
  retrieval, embedding-based insight clustering. The contracts are
  in place (engine version field, card schema versioning) so this
  slots in without breaking consumers.

### Phase 5 — packaging + release

- `pnpm db:seed` — realistic 14-day food history (15 pantry items,
  16 meals with outcomes including recipe candidates, craving-driven
  meals, repeats) that immediately exercises the pattern engine.
- Multi-stage `Dockerfile` + `docker-compose.yml`: one
  `docker compose up` and the API listens on 8787 with the SQLite
  file in `./data/`. MCP runs as a host subprocess of the assistant,
  not in Docker (stdio transport).
- README rewrite for Memex; this CHANGELOG; v0.1.0 git tag.

### Verification

`pnpm verify` green:

- 62 tests across 6 packages
- typecheck + prettier + tests + build all clean

End-to-end sanity:

```
pnpm db:migrate
pnpm db:seed                    # founder + 14 days of meals + pairing code
pnpm --filter @memex/api dev    # API on :8787
# pair an assistant via the printed code, then call its tools
```

### Acknowledgements

The original PantryMind v0 spec (Ludovic Micinthe / Dovik) drove the
food-domain design and is preserved verbatim on the archive branch.
The recommendation engine in `packages/modules/food/src/services/
recommendation/engine.ts` is cherry-picked from that branch — it was
already pure code and survived the rebuild without changes.
