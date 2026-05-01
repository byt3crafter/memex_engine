/**
 * Single source of truth for Memex runtime configuration. Both the
 * REST API and the MCP server load via loadConfig() so behavior is
 * identical across adapters.
 */
import { z } from 'zod';

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
export type LogLevel = z.infer<typeof logLevelSchema>;

const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8787),
  databaseUrl: z.string().min(1).default('file:./data/memex.db'),
  databaseAuthToken: z.string().min(1).optional(),
  bootstrapToken: z.string().min(32, 'MEMEX_BOOTSTRAP_TOKEN must be at least 32 characters'),
  baseUrl: z.string().url().default('http://localhost:8787'),
  defaultTimezone: z.string().min(1).default('UTC'),
  logLevel: logLevelSchema.default('info'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  enabledModules: z.array(z.string()).default([]),
  // Optional per-module config the kernel knows about. Modules read
  // these from ctx.config and disable themselves cleanly when absent.
  telegramBotToken: z.string().min(20).optional(),
  telegramWebhookSecret: z.string().min(16).optional(),
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

const csvFromString = (raw: string | undefined): string[] | undefined => {
  if (raw === undefined || raw === '') return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

export interface LoadConfigOverrides {
  bootstrapToken?: string;
  databaseUrl?: string;
  enabledModules?: string[];
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: LoadConfigOverrides = {},
): AppConfig {
  return configSchema.parse({
    port: intFromString(env['MEMEX_PORT']),
    databaseUrl: overrides.databaseUrl ?? env['MEMEX_DATABASE_URL'],
    databaseAuthToken: env['MEMEX_DATABASE_AUTH_TOKEN'],
    bootstrapToken: overrides.bootstrapToken ?? env['MEMEX_BOOTSTRAP_TOKEN'],
    baseUrl: env['MEMEX_BASE_URL'],
    defaultTimezone: env['MEMEX_DEFAULT_TIMEZONE'],
    logLevel: env['MEMEX_LOG_LEVEL'],
    nodeEnv: env['NODE_ENV'],
    enabledModules: overrides.enabledModules ?? csvFromString(env['MEMEX_MODULES']) ?? [],
    telegramBotToken: env['MEMEX_TELEGRAM_BOT_TOKEN'],
    telegramWebhookSecret: env['MEMEX_TELEGRAM_WEBHOOK_SECRET'],
  });
}
