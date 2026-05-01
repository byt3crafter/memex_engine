/**
 * Iris — Telegram onboarding service. Owns the bot's command surface:
 *
 *   /start    — find or create a Memex user from a Telegram identity,
 *               issue a fresh connection token, send config snippets
 *   /status   — show the user's connections + active modules
 *   /newkey   — issue another connection token (for adding more
 *               assistants) and DM it once
 *   /help     — explain how to plug the token into Claude Desktop /
 *               OpenClaw / Cursor / curl
 *
 * Anything else gets a friendly default reply pointing at /help.
 *
 * The onboarding service NEVER stores cleartext tokens — connection
 * tokens are one-shot, returned by the kernel only at issue time.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '@memex/db';
import type { Kernel, KernelHandle } from '@memex/kernel';
import { nowIso, type Clock, systemClock } from '@memex/kernel';
import * as schema from '../db/schema/index';
import type { TelegramBotClient } from './bot-client';

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
      is_premium?: boolean;
    };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

export interface OnboardingService {
  handleUpdate(update: TelegramUpdate): Promise<void>;
}

export interface OnboardingDeps {
  db: Db;
  bot: TelegramBotClient;
  kernel: Pick<Kernel, 'services' | 'modules' | 'config'> | KernelHandle;
  baseUrl: string;
  botUsername: string;
  clock?: Clock;
}

const ESC = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createOnboardingService(deps: OnboardingDeps): OnboardingService {
  const { db, bot, baseUrl, botUsername } = deps;
  const clock = deps.clock ?? systemClock;
  const k = deps.kernel as Kernel;

  async function findOrCreateMemexUser(tg: NonNullable<TelegramUpdate['message']>['from']): Promise<{
    userId: string;
    isNew: boolean;
  }> {
    if (!tg) throw new Error('no from on telegram update');
    const existing = await db
      .select()
      .from(schema.telegramUser)
      .where(eq(schema.telegramUser.telegramId, tg.id))
      .limit(1)
      .all();
    const now = nowIso(clock);
    if (existing[0]) {
      // Refresh metadata (username can change)
      await db
        .update(schema.telegramUser)
        .set({
          username: tg.username ?? null,
          firstName: tg.first_name ?? null,
          lastName: tg.last_name ?? null,
          languageCode: tg.language_code ?? null,
          isPremium: tg.is_premium ?? false,
          updatedAt: now,
        })
        .where(eq(schema.telegramUser.telegramId, tg.id));
      return { userId: existing[0].userId, isNew: false };
    }

    const displayName =
      [tg.first_name, tg.last_name].filter(Boolean).join(' ').trim() ||
      tg.username ||
      `Telegram user ${tg.id}`;

    const user = await k.services.users.create({
      displayName,
      timezone: 'UTC',
      role: 'member',
      enabledModules: ['food'],
    });

    await db.insert(schema.telegramUser).values({
      telegramId: tg.id,
      userId: user.id,
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
      languageCode: tg.language_code ?? null,
      isPremium: tg.is_premium ?? false,
      notificationsEnabled: false,
      createdAt: now,
      updatedAt: now,
    });

    return { userId: user.id, isNew: true };
  }

  async function issueConnection(userId: string, name: string): Promise<{ token: string; tokenPrefix: string }> {
    const issued = await k.services.connections.issue({
      userId,
      name,
      kind: 'rest_api',
      scopes: ['food:read', 'food:write'],
      metadata: { source: 'telegram_iris' },
    });
    return { token: issued.token, tokenPrefix: issued.connection.tokenPrefix };
  }

  function welcomeMessage(token: string, isNew: boolean, modules: { id: string; codename: string }[]): string {
    const moduleList = modules.map((m) => `• <b>${ESC(m.codename)}</b> — <code>${ESC(m.id)}</code>`).join('\n');
    const greeting = isNew
      ? '🧠 <b>Welcome to Memex</b>'
      : '🧠 <b>Welcome back</b>';
    const note = isNew ? 'Your account has been created.' : 'A new connection token has been issued.';
    return `${greeting}

${note}

<b>Your bearer token</b>:
<code>${ESC(token)}</code>

<i>Save it — it won't be shown again. Lose it? Send /newkey for another.</i>

📋 <b>Plug into your AI assistant</b>

<b>Claude Desktop / OpenClaw / Cursor</b> (MCP, paste in your config):
<pre>{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/path/to/memex/apps/mcp/dist/index.js"],
      "env": {
        "MEMEX_BASE_URL": "${ESC(baseUrl)}",
        "MEMEX_CONNECTION_TOKEN": "${ESC(token)}"
      }
    }
  }
}</pre>

<b>HTTP / curl / scripts</b>:
<pre>curl -H "Authorization: Bearer ${ESC(token)}" \\
  ${ESC(baseUrl)}/api/v1/me</pre>

<b>Modules available</b>
${moduleList}

<b>Commands</b>
/status — your account + connections
/newkey — issue another token (for a 2nd assistant)
/help   — full setup guide`;
  }

  async function listConnectionsText(userId: string): Promise<string> {
    const conns = (await k.services.connections.listForUser(userId)).filter((c) => c.revokedAt == null);
    if (conns.length === 0) return '<i>No active connections.</i> Send /newkey to create one.';
    return conns
      .map((c) => `• <code>${ESC(c.tokenPrefix)}…</code> — ${ESC(c.name)} (${ESC(c.kind)})`)
      .join('\n');
  }

  async function reply(chatId: number, text: string): Promise<void> {
    try {
      await bot.sendMessage(chatId, text, { parseMode: 'HTML', disablePreview: true });
    } catch (err) {
      // Fallback to plain text if HTML parse fails
      const plain = text.replace(/<[^>]+>/g, '');
      try {
        await bot.sendMessage(chatId, plain);
      } catch {
        // Give up; we logged it
      }
    }
  }

  return {
    async handleUpdate(update) {
      const msg = update.message;
      if (!msg || !msg.text || !msg.from || msg.from.is_bot) return;
      const chatId = msg.chat.id;
      const text = msg.text.trim();

      // Strip any "@botname" suffix (group chats include it)
      const command = text.replace(new RegExp(`@${botUsername}\\b`, 'i'), '').trim();

      if (command === '/start' || command.startsWith('/start ')) {
        const { userId, isNew } = await findOrCreateMemexUser(msg.from);
        const issued = await issueConnection(
          userId,
          `Telegram (${msg.from.username ?? msg.from.first_name ?? msg.from.id})`,
        );
        const modules = k.modules.list().map((m) => ({
          id: m.module.manifest.id,
          codename: m.module.manifest.codename,
        }));
        await reply(chatId, welcomeMessage(issued.token, isNew, modules));
        return;
      }

      if (command === '/status') {
        const tg = await db
          .select()
          .from(schema.telegramUser)
          .where(eq(schema.telegramUser.telegramId, msg.from.id))
          .limit(1)
          .all();
        const row = tg[0];
        if (!row) {
          await reply(chatId, "You don't have a Memex account yet. Send /start to create one.");
          return;
        }
        const u = await k.services.users.getById(row.userId);
        const connList = await listConnectionsText(row.userId);
        await reply(
          chatId,
          `<b>Your Memex account</b>\n\n` +
            `User: <code>${ESC(u.id)}</code>\n` +
            `Display: ${ESC(u.displayName)}\n` +
            `Modules: ${u.enabledModules.map((m) => ESC(m)).join(', ') || '<i>(none)</i>'}\n\n` +
            `<b>Active connections</b>\n${connList}`,
        );
        return;
      }

      if (command === '/newkey') {
        const tg = await db
          .select()
          .from(schema.telegramUser)
          .where(eq(schema.telegramUser.telegramId, msg.from.id))
          .limit(1)
          .all();
        const row = tg[0];
        if (!row) {
          await reply(chatId, 'Send /start first to create your Memex account.');
          return;
        }
        const issued = await issueConnection(
          row.userId,
          `Telegram newkey (${msg.from.username ?? msg.from.id})`,
        );
        await reply(
          chatId,
          `🔑 <b>New token issued</b>\n\n<code>${ESC(issued.token)}</code>\n\n` +
            `<i>Save it. Use it for one assistant. Send /newkey again for another.</i>\n\n` +
            `Plug it into your assistant the same way the welcome message described.`,
        );
        return;
      }

      if (command === '/help') {
        await reply(
          chatId,
          `<b>Memex — quick guide</b>\n\n` +
            `Memex is your AI assistant's long-term memory. It doesn't have AI itself — it stores your data, exposes structured tools, and any AI assistant you connect can use them.\n\n` +
            `<b>Setup flow</b>\n` +
            `1. /start — get a bearer token\n` +
            `2. Paste the token into Claude Desktop / OpenClaw / Cursor (MCP config) OR use it as a Bearer header on HTTP calls\n` +
            `3. Your assistant now has Memex's tools (pantry, meals, recipes, recommendations, more)\n\n` +
            `<b>Commands</b>\n` +
            `/start — sign up + get a token\n` +
            `/status — your account + connections\n` +
            `/newkey — issue another token\n` +
            `/help — this guide\n\n` +
            `<b>Source code &amp; docs</b>: <a href="https://github.com/byt3crafter/memex_engine">github.com/byt3crafter/memex_engine</a>\n` +
            `<b>API base</b>: <code>${ESC(baseUrl)}</code>`,
        );
        return;
      }

      // Default: didn't recognize the command
      await reply(
        chatId,
        `I'm a signup bot — I don't chat. Try /start, /status, /newkey, or /help.`,
      );
    },
  };
}
