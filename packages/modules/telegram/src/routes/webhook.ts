/**
 * /webhook/telegram — public route, NOT under bearer auth. Verifies
 * Telegram's secret_token header instead so only Telegram itself can
 * deliver updates.
 *
 * Returns 200 OK as fast as possible — Telegram retries the same
 * update if we don't ack within ~30 seconds. We process the update
 * asynchronously and absorb errors so a single bad update doesn't
 * cause an infinite retry storm.
 */
import { Hono } from 'hono';
import type { TelegramServices, TelegramUpdate } from '../services/index';

export interface WebhookDeps {
  services: TelegramServices;
  secretToken: string;
}

export function webhookRouter(deps: WebhookDeps): Hono {
  const r = new Hono();

  r.post('/', async (c) => {
    const headerSecret = c.req.header('x-telegram-bot-api-secret-token');
    if (headerSecret !== deps.secretToken) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    let update: TelegramUpdate;
    try {
      update = (await c.req.json()) as TelegramUpdate;
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    // Fire-and-forget — Telegram retries if we hold the connection.
    // Errors are caught inside handleUpdate; we only catch top-level here.
    void deps.services.ensureBotIdentity().then(async () => {
      try {
        await deps.services.onboarding.handleUpdate(update);
      } catch {
        // swallow — already logged inside the handler
      }
    });

    return c.json({ ok: true });
  });

  return r;
}
