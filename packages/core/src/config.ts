/**
 * Single source of truth for runtime configuration. Both apps/api and
 * apps/mcp call `loadConfig()` at startup so behavior stays identical
 * across adapters.
 */
import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
export type LogLevel = z.infer<typeof logLevelSchema>;

const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8787),
  databaseUrl: z.string().min(1).default('file:./data/pantrymind.db'),
  databaseAuthToken: z.string().min(1).optional(),
  apiToken: z.string().min(16, 'HEALTHLOOP_API_TOKEN must be at least 16 characters'),
  baseUrl: z.string().url().default('http://localhost:8787'),
  defaultTimezone: z.string().min(1).default('UTC'),
  logLevel: logLevelSchema.default('info'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof configSchema>;

const intFromString = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`expected integer, got "${raw}"`);
  }
  return n;
};

export interface LoadConfigOverrides {
  /** Skip env-var enforcement; useful for tests. */
  apiToken?: string | undefined;
  databaseUrl?: string | undefined;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: LoadConfigOverrides = {},
): AppConfig {
  return configSchema.parse({
    port: intFromString(env['HEALTHLOOP_PORT']),
    databaseUrl: overrides.databaseUrl ?? env['HEALTHLOOP_DATABASE_URL'],
    databaseAuthToken: env['HEALTHLOOP_DATABASE_AUTH_TOKEN'],
    apiToken: overrides.apiToken ?? env['HEALTHLOOP_API_TOKEN'],
    baseUrl: env['HEALTHLOOP_BASE_URL'],
    defaultTimezone: env['HEALTHLOOP_DEFAULT_TIMEZONE'],
    logLevel: env['HEALTHLOOP_LOG_LEVEL'],
    nodeEnv: env['NODE_ENV'],
  });
}
