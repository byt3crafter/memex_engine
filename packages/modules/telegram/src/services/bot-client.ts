/**
 * Tiny typed wrapper around the Telegram Bot API. Only the methods we
 * actually use — keeps the dependency surface zero (uses native fetch).
 */
export interface SendMessageOptions {
  parseMode?: 'HTML' | 'MarkdownV2';
  disablePreview?: boolean;
  replyMarkup?: Record<string, unknown>;
}

export interface TelegramBotClient {
  readonly username: string | null;
  getMe(): Promise<{ id: number; username: string; firstName: string }>;
  sendMessage(chatId: number, text: string, opts?: SendMessageOptions): Promise<void>;
  setWebhook(url: string, secretToken: string): Promise<void>;
  deleteWebhook(): Promise<void>;
  getWebhookInfo(): Promise<{ url: string; has_custom_certificate: boolean; pending_update_count: number }>;
}

export interface BotClientOptions {
  token: string;
  fetch?: typeof fetch;
}

export function createBotClient(opts: BotClientOptions): TelegramBotClient {
  const token = opts.token;
  const f = opts.fetch ?? fetch;
  const base = `https://api.telegram.org/bot${token}`;

  let cachedUsername: string | null = null;

  async function call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await f(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      throw new Error(`telegram ${method} failed: ${json.description ?? 'unknown'}`);
    }
    return json.result as T;
  }

  return {
    get username() {
      return cachedUsername;
    },
    async getMe() {
      const r = await call<{ id: number; username: string; first_name: string }>('getMe');
      cachedUsername = r.username;
      return { id: r.id, username: r.username, firstName: r.first_name };
    },
    async sendMessage(chatId, text, options = {}) {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text,
        ...(options.parseMode !== undefined ? { parse_mode: options.parseMode } : {}),
        ...(options.disablePreview ? { disable_web_page_preview: true } : {}),
        ...(options.replyMarkup !== undefined ? { reply_markup: options.replyMarkup } : {}),
      };
      await call<unknown>('sendMessage', body);
    },
    async setWebhook(url, secretToken) {
      await call<unknown>('setWebhook', {
        url,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
    },
    async deleteWebhook() {
      await call<unknown>('deleteWebhook', { drop_pending_updates: true });
    },
    async getWebhookInfo() {
      return await call<{ url: string; has_custom_certificate: boolean; pending_update_count: number }>(
        'getWebhookInfo',
      );
    },
  };
}
