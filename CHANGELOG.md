# Changelog

All notable changes to Memex are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches `v0.1.0`.

## [Unreleased]

### Memex rebuild — pivot from PantryMind prototype

The single-user PantryMind prototype (preserved on
`archive/v0-pantrymind-prototype` — 18 commits, 75 passing tests, full
food-loop demo) is the design study. Memex is the real product:
multi-user, kernel + module plugin contract, real connection/pairing
flow for arbitrary AI assistants. The food domain is now the Demeter
module, one of many planned.

#### Phase 0 — workspace and kernel scaffolding (in progress)

- Fresh `package.json` under name `memex`, all packages renamed to
  `@memex/*`, env vars renamed to `MEMEX_*`.
- pnpm workspace covering `apps/*`, `packages/*`, and
  `packages/modules/*`.
- Turborepo task graph, strict tsconfig.base, Prettier.
- `packages/kernel/` — `Module<S>` interface, kernel registry, kernel
  context type.
- `packages/schemas/` — kernel-level Zod (User, Connection,
  PairingCode, Card base, Module manifest).
- `packages/db/` — kernel migration `0000_kernel.sql` (user,
  connection, pairing_code, module_registry).
- README rewritten for Memex; codename roadmap documented.

#### Phase 1 — multi-user, auth, pairing flow (planned)

- userService, connectionService, pairingService.
- Token hashing (sha256); bearer auth resolves to user via
  connection.
- Founder bootstrap from `MEMEX_BOOTSTRAP_TOKEN`.
- `apps/api` with `/health`, `/admin/bootstrap`,
  `/api/v1/connections/{pair-start,pair-complete}`,
  `/api/v1/connections`, `/api/v1/me`.
- QR payload / config-snippet generation per assistant kind.

#### Phase 2 — module-food (Demeter v0.1)

- Cherry-pick recommendation engine, food schemas, food drizzle
  tables from the archive.
- All food services accept `userId` from request context.
- Demeter mounts under `/api/v1/food/*`.

#### Phase 3 — MCP server with module-shaped tool registration

- Tools, resources, prompts contributed by modules; MCP server
  iterates the registry.
- Per-connection MCP token auth.
