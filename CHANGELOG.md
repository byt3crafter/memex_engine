# Changelog

All notable changes to Memex are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-05-15

Semantic recall layer for Demeter. The food module can now embed meals and
recipes into vector space and find what the user has actually eaten before
that is semantically close to what they are craving. When the sqlite-vec
extension and local embedding model are available, the recommendation engine
upgrades from reco@v1 (deterministic) to reco@v2 (deterministic + semantic);
reco@v1 rows remain valid and fully replayable.

### Schema

- **`recipe_vec(recipe_id TEXT PK, embedding FLOAT[384])`** — vec0 virtual
  table for recipe embeddings. Applied at runtime by `EmbeddingService` after
  loading the sqlite-vec extension; skipped gracefully if the extension is
  absent.
- **`food_event_vec(food_event_id TEXT PK, embedding FLOAT[384])`** — same
  for food events. Only actual_meal events are indexed.
- DDL reference: `packages/modules/food/drizzle/0001_embeddings.sql`.

### Embedding pipeline (`packages/modules/food/src/services/embeddings.ts`)

- Local sentence-transformer via `@huggingface/transformers`
  (`Xenova/all-MiniLM-L6-v2`, 384-dim). Module-level singleton — loads once,
  never blocks the write path.
- Graceful fallback: if model download is disabled
  (`MEMEX_ALLOW_MODEL_DOWNLOAD` not set) or the model fails to load, all
  embedding methods return `null` and the system continues with reco@v1.
- Embed-on-write hooks in `buildFoodServices`: `foodEvents.create` and
  `recipes.create` / `promoteFromFoodEvent` trigger async embedding that
  cannot fail the write.
- `findSimilarMeals(userId, queryText, limit)` — KNN over `food_event_vec`,
  filtered by user, ordered by distance.
- `findSimilarRecipes(userId, queryText, limit)` — KNN over `recipe_vec`.

### Recommendation engine v2 (`reco@v2`)

- New file `packages/modules/food/src/services/recommendation/engine_v2.ts`.
  Pure function taking the same `RecommendationContext` as v1 plus a
  `SemanticContext` callback pair.
- **Craving-history boost**: if a craving string semantically matches a past
  `food_event` that had satisfaction ≥ 4, recipes promoted from that event get
  a `+0.12` score boost and a "semantically similar to a meal you loved" note.
- **Fuzzy ingredient boost**: ingredients in a recipe's missing list are
  matched against pantry items by embedding similarity. A fuzzy match (e.g.
  "chicken thigh" ≈ "chicken breast") awards a partial `+0.08` boost scaled
  by the fraction of missing ingredients covered.
- Stamped `engineVersion: 'reco@v2'` on persisted rows when semantic context
  fires; reco@v1 rows coexist for replayability.
- Auto-selects v2 when `EmbeddingService.isAvailable()` returns true;
  falls back to v1 otherwise — no config change required.

### New MCP tool: `find_similar_meals`

- Input: `{ text: string, limit?: number }` (default 5, max 20).
- Returns the user's past `actual_meal` food_events ordered by embedding
  distance to the query — **recall of real eaten meals, not future
  recommendations**.
- Returns `{ available: false }` gracefully when semantic recall is disabled.

### Infrastructure

- `@memex/db`: new `loadVecExtension(client): Promise<boolean>` helper with
  graceful fallback (logs warning, returns false on any error).
- `ModuleContext` gains optional `client?: Client` forwarded from
  `createKernel`. Apps pass `client` from `createDb` so modules can load
  native extensions.
- `BuildFoodServicesDeps` gains optional `client?: Client`.

### Dependencies added

| Package                           | Where                                 | Purpose                           |
| --------------------------------- | ------------------------------------- | --------------------------------- |
| `sqlite-vec@0.1.9`                | `@memex/db`                           | Native vec0 SQLite extension      |
| `@huggingface/transformers@4.2.0` | `@memex/module-food`                  | all-MiniLM-L6-v2 pipeline         |
| `@libsql/client`                  | `@memex/kernel`, `@memex/module-food` | Client type for extension loading |

### Tests added

- `embeddings.test.ts` — embedder singleton, CCR-skippable model download
  test, vec integration test (also skipped without `MEMEX_ALLOW_MODEL_DOWNLOAD=1`).
- `engine_v2.test.ts` — 5 pure unit tests for v2 scoring, all run without
  model/extension (mock `SemanticContext`). Tests: null semantic = same as v1,
  empty semantic = no change, craving-history boost fires, fuzzy ingredient
  boost fires, v2 scores higher than v1 when semantic fires.

Previously deferred from v0.1.0:

> sqlite-vec + local embeddings (semantic recall in recommendation engine v2,
> fuzzy recipe retrieval, embedding-based insight clustering). The contracts are
> in place (engine version field, card schema versioning) so this slots in
> without breaking consumers.

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
