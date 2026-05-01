/**
 * Iris — Telegram onboarding module for Memex.
 *
 * What it does:
 *   • /start in @memex_engineBot creates a Memex user keyed on
 *     telegram_id and DMs the user a fresh bearer token + paste-able
 *     config snippets for Claude Desktop / OpenClaw / Cursor / curl.
 *   • /status shows the user's account + active connections.
 *   • /newkey issues another token for a second assistant.
 *   • /help explains the setup flow.
 *
 * What it does NOT do (for now):
 *   • Chat with users via an LLM (no AI here — assistants are the brains).
 *   • Notifications / proactive nudges (next iteration).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModule, type Module } from '@memex/kernel';
import { webhookRouter } from './routes/webhook';
import { buildTelegramServices, type TelegramServices } from './services/index';

export * from './services/index';
export * from './db/schema/index';

function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'drizzle');
}

/**
 * Inputs the Telegram module needs that aren't part of the kernel
 * config schema. Read from env in apps/api/src/index.ts and passed
 * here.
 */
export interface TelegramModuleOptions {
  botToken: string;
  webhookSecret: string;
}

export function defineTelegramModule(options: TelegramModuleOptions): Module<TelegramServices> {
  return defineModule<TelegramServices>({
    manifest: {
      id: 'telegram',
      codename: 'Iris',
      version: '0.1.0',
      description:
        "Telegram-based signup, identity, and (later) notification gateway. Users sign up via @memex_engineBot's /start command and receive a bearer token they can plug into any AI assistant.",
      domain: 'identity',
      category: 'Identity & onboarding',
      icon: '🪪',
      tagline: 'Sign up via Telegram. Get a token. Plug it into any AI assistant.',
      features: [
        '/start → instant Memex account keyed on your Telegram identity',
        'Per-assistant bearer tokens (one Memex user can pair many assistants)',
        '/newkey to issue another token, /status to inspect your account',
        'Future: morning/weekly notifications pushed to Telegram',
      ],
      routePrefix: 'telegram',
      dependsOn: [],
      scopes: ['telegram:read'],
      homepage: 'https://t.me/memex_engineBot',
    },
    migrationsFolder: migrationsFolder(),
    cards: [],
    buildServices: (ctx) =>
      buildTelegramServices({
        db: ctx.db,
        kernel: ctx.kernel as never, // KernelHandle is a subset; the module needs full Kernel — passed at apps/api boot via ctx.
        botToken: options.botToken,
        baseUrl: ctx.config.baseUrl,
      }),
    // Telegram's webhook lives outside /api/v1/* — see apps/api/src/server.ts
    // which mounts buildWebhookRoutes() under /webhook/<id>/.
    buildWebhookRoutes: (services) => webhookRouter({ services, secretToken: options.webhookSecret }),
  });
}
