# Memex — multi-stage Dockerfile for the REST API server.
#
# Build:    docker build -t memex .
# Run:      docker run --rm -p 8787:8787 -v $(pwd)/data:/data \
#             -e MEMEX_BOOTSTRAP_TOKEN=$(openssl rand -hex 32) memex
#
# Or use docker-compose.yml in the repo root.
#
# The MCP server is stdio-based and runs as a subprocess of the
# assistant — Docker ships only the API. Pair an assistant via
# /admin/bootstrap then /api/v1/connections/pair-complete.

# ─── deps ───────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps apps
COPY packages packages

RUN pnpm install --frozen-lockfile --prefer-offline


# ─── runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy resolved deps + source. We run via tsx so the workspace's
# source-only `exports` resolve at runtime without a separate bundling
# step. Future optimization: tsup-bundle apps/api into a single .js.
COPY --from=deps /app .

ENV NODE_ENV=production \
    MEMEX_PORT=8787 \
    MEMEX_DATABASE_URL=file:/data/memex.db \
    MEMEX_BASE_URL=http://localhost:8787

EXPOSE 8787
VOLUME ["/data"]

# Run kernel migrations on every start (idempotent) then launch the
# API server. Founder bootstrap still requires an explicit POST to
# /admin/bootstrap with MEMEX_BOOTSTRAP_TOKEN.
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @memex/api exec tsx src/index.ts"]
