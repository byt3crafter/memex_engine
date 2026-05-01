# Changelog

All notable changes to PantryMind are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `v0.1.0`.

## [Unreleased]

### Phase 0 — Repo bootstrap (complete)

- Initialize git repository on `main`.
- MIT license, `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22),
  `.env.example`.
- Product spec, architecture overview, and assistant-onboarding guide
  under `docs/`.
- pnpm workspace + Turborepo + shared `tsconfig.base.json` with strict
  ESM settings (`verbatimModuleSyntax`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`).
- Prettier configured as the lint floor; `.prettierignore` excludes
  generated files.

### Phase 1 — Skeleton (complete)

- `packages/schemas` — Zod models for `UserProfile`, `PantryItem`,
  `FoodEvent` + `FoodEventItem`, `Recommendation`, `MealOutcome`,
  `Recipe`, `MenuPlan`, `Measurement`, `ExerciseEvent`, plus the
  versioned `Card` discriminated union (`cardSchemaVersion: 1`).
- `packages/db` — Drizzle schema for the 10 spec tables with proper
  foreign keys, cascade rules, and indexes on common access paths.
  libSQL client factory, prefixed cuid2 ids (`usr_`, `pty_`, `fev_`,
  `rec_`, `out_`, `rcp_`, etc.), `pnpm db:migrate` script, generated
  `0000_init.sql` migration.
- `packages/core` — typed service factories (profile, pantry,
  food-event, recommendation, recipe, menu, pattern) plus
  `loadConfig()` reading `HEALTHLOOP_*` env vars with Zod validation.
  Services are stubbed; bodies arrive in Phase 2 (and Phase 4 for
  pattern).
- `apps/api` — Hono v4 server with bearer-token auth, `GET /health`,
  `GET /api/v1/version`, structured Pino logger, error handler mapping
  `HTTPException` / `ZodError` / unknown errors to a stable shape.
- `apps/mcp` — `@modelcontextprotocol/sdk` server shell over stdio
  transport. Tools land in Phase 3.

#### Verification

- `pnpm verify` (typecheck + lint + test + build) green across all 5
  workspace packages.
- 22 unit tests passing total: 8 schemas, 3 db round-trip, 5 config,
  5 api smoke, 1 mcp shell.
- `pnpm db:migrate` applies the init migration to a libSQL file and
  creates all 10 spec tables.

### Phase 2 — Food loop (complete)

The product wedge — every domain action implemented end-to-end with
matching REST routes and tests, no LLM required.

- **Domain utilities & test harness** — `packages/core/src/util` (clock,
  ISO date helpers, `normalizeName`) and
  `@pantrymind/core/test-support` exposing `setupTestHarness()`. Every
  service test runs against a fresh tempfile libSQL with real
  migrations applied.
- **Profile** — `getCurrentProfile()` auto-creates the singleton row;
  `updateCurrentProfile(patch)` partial-merges. `GET/PUT /api/v1/profile`.
- **Pantry** — list (category / availability / search), create,
  update, soft delete, bulk-update with optional replace mode.
  `PantryItemNotFoundError → 404`. Routes under `/api/v1/pantry`.
- **Food events + items + outcomes** — append-only event log with
  attached items; outcomes upsert by `food_event_id` so re-asking
  doesn't duplicate. `FoodEventNotFoundError → 404`. Routes under
  `/api/v1/food-events`.
- **Recipe** — full CRUD (soft delete via `is_active=false`),
  `promoteFromFoodEvent` lifts a logged meal into a recipe with
  override hooks (title / tags / description / proteinSource) and
  carries `satisfactionScore → personalRating`. `RecipeNotFoundError →
404`. Routes under `/api/v1/recipes`, including
  `POST /from-food-event/:id`.
- **Recommendation engine v1** — deterministic, pure scoring engine
  (`services/recommendation/engine.ts`) over a context (pantry, active
  recipes, last-30-day events with outcomes, optional craving /
  preferred protein). Heuristic: ingredient overlap, protein-on-hand,
  preferred-protein match, recent-repeat penalty (≤7 days),
  outcome-history bonus, craving-text token match, plus 3 freestyle
  bowl/plate/sandwich templates from pantry alone. Engine version
  stamped on every persisted row (`reco@v1`). Service persists pantry
  snapshot + reasoning + a `meal_recommendation` card with
  log_eaten / save_recipe / add_to_shopping_list actions. Routes
  under `/api/v1/recommendations` (`POST /meal`, `GET /:id`,
  `POST /:id/select`).
- **Menu suggestion v1** — `services/menu.ts` builds an N-day menu
  (default 3) with two slots per day, ranks active recipes by
  pantry-overlap ratio, computes `shoppingGaps` as the deduplicated
  set of required ingredients not in pantry, stamps a `menu` card.
  Empty-recipe state returns a friendly `prepNotes` hint. Routes
  under `/api/v1/menus`.
- **Export** — `services/export.exportAll()` returns a complete JSON
  bundle (profile + pantry + foodEvents + recipes + recommendations +
  menus + measurements + exerciseEvents) with `schemaVersion: 1`.
  Surfaces as `GET /api/v1/export/json`.
- **`pnpm demo:dry-run`** — `apps/api/scripts/demo.ts` walks the full
  loop end-to-end (profile → pantry → recommend → log meal → outcome
  → promote recipe → menu → export) and prints PASS/FAIL per step.
  9/9 PASS. This is the no-GUI acceptance test.

#### Verification

- `pnpm verify` (typecheck + prettier + tests + build) green.
- 75 tests passing total: 5 schemas, 3 db, 5 normalizeName + config,
  4 profile + 7 pantry + 5 food-event + 6 recipe + 4 reco-engine + 3
  reco-service + 3 menu (service-level), and 5 server-smoke + 4
  profile + 6 pantry + 6 food-events + 4 recipes + 4 recommendations
  - 3 menus + 1 export (route-level), plus 1 mcp shell.
- `pnpm demo:dry-run` exits 0 with all 9 steps green.

### Phase 3 — MCP server (planned)

- Wire all 12 spec tools to the same core services.
- Resources, prompts, onboarding-prompt-by-assistant.
- MCP test harness exercising every tool's happy path.
