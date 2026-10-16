import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTelegramBridge } from '../src/telegram.js';
import { eventually, startGateway, stopAll } from './helpers.js';
import type { TestGateway } from './helpers.js';

/** A tiny stand-in for the Telegram Bot API. */
function fakeTelegram() {
  const sent: { chat_id: string; text: string; message_id: number; reply_markup?: any; reply_to_message_id?: number }[] = [];
  const answers: string[] = [];
  const queue: any[] = [];
  let updateId = 1;
  let messageId = 100;
  let waiter: (() => void) | null = null;

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const method = req.url!.split('/').pop();
      const body = raw ? JSON.parse(raw) : {};
      const ok = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
      switch (method) {
        case 'getMe':
          return ok({ id: 1, username: 'agw_test_bot' });
        case 'getUpdates': {
          const ready = queue.filter((u) => u.update_id >= (body.offset ?? 0));
          if (ready.length) return ok(ready);
          await new Promise<void>((r) => {
            waiter = r;
            setTimeout(r, 200);
          });
          return ok(queue.filter((u) => u.update_id >= (body.offset ?? 0)));
        }
        case 'sendMessage': {
          const m = { ...body, chat_id: String(body.chat_id), message_id: ++messageId };
          sent.push(m);
          return ok({ message_id: m.message_id });
        }
        case 'answerCallbackQuery':
          answers.push(body.text);
          return ok(true);
        default:
          return ok(true);
      }
    });
  });
  return {
    server,
    sent,
    answers,
    push(update: Record<string, unknown>) {
      queue.push({ update_id: updateId++, ...update });
      waiter?.();
    },
    text(chat: number, text: string, replyTo?: number) {
      this.push({
        message: { message_id: ++messageId, chat: { id: chat }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) },
      });
    },
    tap(chat: number, messageIdTapped: number, data: string) {
      this.push({ callback_query: { id: `cb${updateId}`, data, message: { message_id: messageIdTapped, chat: { id: chat } } } });
    },
  };
}

let gw: TestGateway;
let tg: ReturnType<typeof fakeTelegram>;
let bridge: Awaited<ReturnType<typeof startTelegramBridge>>;

beforeAll(async () => {
  gw = await startGateway();
  tg = fakeTelegram();
  await new Promise<void>((r) => tg.server.listen(0, '127.0.0.1', r));
  bridge = await startTelegramBridge(gw.app.gateway, {
    token: 'test-token',
    apiBase: `http://127.0.0.1:${(tg.server.address() as AddressInfo).port}`,
    pollTimeoutSeconds: 1,
  });
});
afterAll(async () => {
  await bridge.stop();
  tg.server.close();
  stopAll();
});

const BOSS_CHAT = 4242;

describe('Telegram bridge', () => {
  it('links a chat, asks for approvals with buttons, relays messages and replies', async () => {
    expect(bridge.username).toBe('agw_test_bot');
    const boss = await gw.person('boss');
    const claw = await gw.agent('boss-claw', boss);
    const me = await gw.person('ludo');
    const myClaude = await gw.agent('ludo-claude', me);
    const { invite } = await boss.client.createInvite({ agent: claw.handle });
    await me.client.redeem(invite.code);
    const { conversation } = await myClaude.client.createConversation({ title: 'Q3', members: [claw.handle] });

    // Link.
    const { code } = await boss.client.telegramLinkCode();
    tg.text(BOSS_CHAT, `/start ${code}`);
    await eventually(async () => tg.sent.find((m) => m.text.startsWith(`Linked to ${boss.handle}`)), 'link confirmation');
    expect((await boss.client.me()).telegramLinked).toBe(true);

    // A request arrives: the boss gets the text with Approve/Reject buttons.
    await myClaude.client.post(conversation.id, { body: 'Send me the Q3 numbers' });
    const ask = await eventually(async () => tg.sent.find((m) => m.reply_markup?.inline_keyboard), 'approval prompt');
    expect(ask.chat_id).toBe(String(BOSS_CHAT));
    expect(ask.text).toContain(`${myClaude.handle} wants ${claw.handle} in “Q3” to:`);
    expect(ask.text).toContain('Send me the Q3 numbers');

    // He taps Approve.
    const approveData = ask.reply_markup.inline_keyboard[0][0].callback_data as string;
    tg.tap(BOSS_CHAT, ask.message_id, approveData);
    await eventually(async () => tg.answers.includes('Approved'), 'callback answer');
    const task = (await claw.client.list('inbox', ['submitted'])).tasks[0]!;
    expect(task.body).toBe('Send me the Q3 numbers');
    await eventually(async () => tg.sent.find((m) => m.text.startsWith('✅ Approved')), 'resolution note');

    // The agent answers; the boss sees it and replies from Telegram into the conversation.
    await claw.client.setStatus(task.id, 'completed', 'Revenue $1.2M, margin 18%.');
    const relayed = await eventually(async () => tg.sent.find((m) => m.text.includes('Revenue $1.2M')), 'relayed reply');
    tg.text(BOSS_CHAT, 'Thanks, share totals only with clients.', relayed.message_id);
    await eventually(
      async () => (await me.client.messages(conversation.id)).messages.find((m) => m.author === boss.handle && m.body.startsWith('Thanks')),
      'boss message in conversation',
    );

    // Replying to an approval request with text approves an edited version.
    await myClaude.client.post(conversation.id, { body: 'Also the client list please' });
    const second = await eventually(
      async () => tg.sent.find((m) => m.reply_markup?.inline_keyboard && m.text.includes('client list')),
      'second approval prompt',
    );
    tg.text(BOSS_CHAT, 'Number of clients only, no names.', second.message_id);
    await eventually(async () => {
      const tasks = (await claw.client.list('inbox', ['submitted'])).tasks;
      return tasks.find((t) => t.body === 'Number of clients only, no names.');
    }, 'edited request');

    // Commands.
    tg.text(BOSS_CHAT, `/pause ${claw.handle}`);
    await eventually(async () => tg.sent.find((m) => m.text.startsWith(`${claw.handle} is paused`)), 'pause');
    expect((await boss.client.myAgents()).agents[0]?.paused).toBe(true);
    tg.text(BOSS_CHAT, '/quiet');
    await eventually(async () => tg.sent.find((m) => m.text.startsWith('Only approval requests')), 'quiet');
  });

  it('ignores chats that are not linked', async () => {
    tg.text(999, 'hello?');
    await eventually(async () => tg.sent.find((m) => m.chat_id === '999' && m.text.includes('isn’t linked')), 'unlinked notice');
  });
});
