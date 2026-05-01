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

### Phase 2 — Food loop (planned)

- Profile, pantry, food-event, recommendation, outcome, recipe-promotion,
  menu-suggestion, export endpoints + tests.
- Deterministic recommendation engine v1 (no LLM).
- `pnpm demo:dry-run` script walking the full no-GUI loop.
