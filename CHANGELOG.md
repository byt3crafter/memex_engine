# Changelog

All notable changes to PantryMind are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `v0.1.0`.

## [Unreleased]

### Phase 0 — Repo bootstrap

- Initialize git repository on `main`.
- MIT license, `.gitignore`, `.editorconfig`, `.nvmrc` (Node 22),
  `.env.example`.
- Product spec, architecture overview, and assistant-onboarding draft
  under `docs/`.
- pnpm workspace + Turborepo + shared TypeScript config (pending).

### Phase 1 — Skeleton (in progress)

- `packages/schemas` — Zod models for every entity + `Card` discriminated
  union (pending).
- `packages/db` — Drizzle schema for the 10 spec tables, libSQL client,
  first migration (pending).
- `packages/core` — service module skeleton (pending).
- `apps/api` — Hono server with bearer auth, `/health`,
  `/api/v1/version`, structured logging, and a smoke test (pending).
- `apps/mcp` — MCP server shell (pending).
